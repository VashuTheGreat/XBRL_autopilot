/**
 * Manages the bundled Python sidecar (FastAPI): spawn, health check, restart, stop, proxy.
 * See docs/02-architecture.md ("Processes & lifecycle") and docs/11-security-privacy.md.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { HttpMethod, SidecarLogLine, SidecarResponse, SidecarStatus } from '@shared/ipc'
import {
  generateToken,
  getFreePort,
  isAllowedSidecarPath,
  parseHealth,
  resolveSidecarLaunch,
  restartDelayMs,
} from './sidecar-utils'

const HEALTH_TIMEOUT_MS = 120_000 // first dev run may need `uv` to sync deps
const HEALTH_INTERVAL_MS = 500
const MAX_RESTARTS = 3
const MAX_LOG_LINES = 2000

export interface SidecarOptions {
  isPackaged: boolean
  repoRoot: string
  resourcesPath: string
  /** Extra env for the child, e.g. GROQ_API_KEY from safeStorage (packaged) */
  extraEnv?: () => Record<string, string | undefined>
}

export class SidecarManager extends EventEmitter {
  private child: ChildProcess | null = null
  private port = 0
  private token = ''
  private status: SidecarStatus = { state: 'stopped' }
  private logs: SidecarLogLine[] = []
  private restarts = 0
  private stopping = false
  private generation = 0

  constructor(private readonly opts: SidecarOptions) {
    super()
  }

  getStatus(): SidecarStatus {
    return this.status
  }

  getLogs(): SidecarLogLine[] {
    return [...this.logs]
  }

  async start(): Promise<void> {
    this.stopping = false
    const gen = ++this.generation
    this.setStatus({ state: 'starting' })
    try {
      this.port = await getFreePort()
      this.token = generateToken()
      const launch = resolveSidecarLaunch({
        isPackaged: this.opts.isPackaged,
        repoRoot: this.opts.repoRoot,
        resourcesPath: this.opts.resourcesPath,
        platform: process.platform,
      })
      this.log('system', `Starting sidecar: ${launch.command} ${launch.args.join(' ')} (port ${this.port})`)
      const child = spawn(launch.command, launch.args, {
        cwd: launch.cwd,
        env: {
          ...process.env,
          ...(this.opts.extraEnv?.() ?? {}),
          XAP_PORT: String(this.port),
          XAP_TOKEN: this.token,
          XAP_RESOURCES: this.opts.isPackaged ? this.opts.resourcesPath : this.opts.repoRoot,
          PYTHONUNBUFFERED: '1',
          PYTHONIOENCODING: 'utf-8',
        },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      this.child = child
      child.stdout?.setEncoding('utf8').on('data', (d: string) => this.logChunk('stdout', d))
      child.stderr?.setEncoding('utf8').on('data', (d: string) => this.logChunk('stderr', d))
      child.on('error', (err) => {
        this.log('system', `Sidecar failed to spawn: ${err.message}`)
        if (gen === this.generation) this.setStatus({ state: 'error', message: err.message })
      })
      child.on('exit', (code, signal) => {
        this.log('system', `Sidecar exited (code ${code ?? '-'}, signal ${signal ?? '-'})`)
        if (this.child === child) this.child = null
        if (this.stopping || gen !== this.generation) return
        // Crash after a healthy start → auto-restart. A failure during startup is reported by
        // waitForHealth instead (restarting a broken environment in a loop helps nobody).
        if (this.status.state === 'ready') this.scheduleRestart(`exited with code ${code ?? signal}`)
      })
      await this.waitForHealth(gen)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (gen === this.generation) {
        this.log('system', `Sidecar start failed: ${message}`)
        this.setStatus({ state: 'error', message })
      }
    }
  }

  async restart(): Promise<void> {
    this.restarts = 0
    await this.stop()
    await this.start()
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.generation++
    const child = this.child
    this.child = null
    if (child?.pid) {
      if (process.platform === 'win32') {
        // `uv run` spawns python as a grandchild; kill the whole tree.
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      } else {
        child.kill('SIGTERM')
      }
    }
    this.setStatus({ state: 'stopped' })
  }

  /** Proxy a request from the renderer. The token never leaves the main process. */
  async request<T>(method: HttpMethod, path: string, body?: unknown): Promise<SidecarResponse<T>> {
    if (!isAllowedSidecarPath(path)) throw new Error(`Sidecar path not allowed: ${path}`)
    if (this.status.state !== 'ready') throw new Error('AI engine (sidecar) is not ready')
    const res = await fetch(`http://127.0.0.1:${this.port}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(120_000),
    })
    const text = await res.text()
    let data: unknown = text
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      /* keep raw text */
    }
    return { status: res.status, data: data as T }
  }

  private async waitForHealth(gen: number): Promise<void> {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (gen !== this.generation) return
      if (!this.child) throw new Error('Sidecar process exited during startup')
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/health`, { signal: AbortSignal.timeout(2000) })
        const health = parseHealth(await res.json())
        if (res.ok && health) {
          this.restarts = 0
          this.log('system', `Sidecar ready (v${health.version})`)
          this.setStatus({
            state: 'ready',
            port: this.port,
            version: health.version,
            aiEnabled: Boolean(health.ai?.enabled),
            model: health.ai?.model ?? null,
          })
          return
        }
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, HEALTH_INTERVAL_MS))
    }
    throw new Error(`Sidecar did not become healthy within ${HEALTH_TIMEOUT_MS / 1000}s`)
  }

  private scheduleRestart(reason: string): void {
    if (this.restarts >= MAX_RESTARTS) {
      this.setStatus({ state: 'error', message: `Sidecar ${reason}; gave up after ${MAX_RESTARTS} restarts` })
      return
    }
    const delay = restartDelayMs(this.restarts++)
    this.log('system', `Restarting sidecar in ${delay} ms (${reason})`)
    this.setStatus({ state: 'starting' })
    setTimeout(() => {
      if (!this.stopping) void this.start()
    }, delay)
  }

  private setStatus(s: SidecarStatus): void {
    this.status = s
    this.emit('status', s)
  }

  private logChunk(stream: 'stdout' | 'stderr', chunk: string): void {
    for (const line of chunk.split(/\r?\n/)) if (line.trim()) this.log(stream, line)
  }

  private log(stream: SidecarLogLine['stream'], text: string): void {
    const line: SidecarLogLine = { ts: Date.now(), stream, text: text.replaceAll(this.token || '\u0000', '***') }
    this.logs.push(line)
    if (this.logs.length > MAX_LOG_LINES) this.logs.splice(0, this.logs.length - MAX_LOG_LINES)
    this.emit('log', line)
  }
}
