/**
 * Pure helpers for the sidecar manager (no Electron imports, unit-tested in ui/test).
 */
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { join } from 'node:path'

export interface SidecarLaunch {
  command: string
  args: string[]
  cwd: string
}

/** Paths the renderer may call through `sidecar:request`. Everything else is rejected. */
export function isAllowedSidecarPath(path: string): boolean {
  if (typeof path !== 'string' || path.length > 2048) return false
  if (!path.startsWith('/')) return false
  if (path.includes('..') || path.includes('\\') || path.includes('://')) return false
  return path === '/health' || path.startsWith('/health?') || path.startsWith('/api/v1/')
}

export function generateToken(): string {
  return randomBytes(32).toString('hex')
}

/** Ask the OS for a free TCP port on loopback. */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        const { port } = addr
        srv.close(() => resolve(port))
      } else {
        srv.close(() => reject(new Error('Could not determine a free port')))
      }
    })
  })
}

/**
 * Dev: run the FastAPI app from the repo with uv (`uv run python -m api`).
 * Packaged: run the PyInstaller onedir executable shipped in resources/sidecar.
 */
export function resolveSidecarLaunch(opts: {
  isPackaged: boolean
  repoRoot: string
  resourcesPath: string
  platform: NodeJS.Platform
}): SidecarLaunch {
  if (opts.isPackaged) {
    const exe = opts.platform === 'win32' ? 'xap-sidecar.exe' : 'xap-sidecar'
    const dir = join(opts.resourcesPath, 'sidecar')
    return { command: join(dir, exe), args: [], cwd: dir }
  }
  return { command: 'uv', args: ['run', 'python', '-m', 'api'], cwd: opts.repoRoot }
}

export interface HealthPayload {
  status: string
  version: string
  ai?: { enabled?: boolean; model?: string | null }
}

export function parseHealth(body: unknown): HealthPayload | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (b.status !== 'ok' || typeof b.version !== 'string') return null
  const ai = (b.ai && typeof b.ai === 'object' ? b.ai : {}) as HealthPayload['ai']
  return { status: 'ok', version: b.version, ai }
}

/** Exponential backoff for restarts: 1s, 2s, 4s … capped at 10s. */
export function restartDelayMs(attempt: number): number {
  return Math.min(10_000, 1000 * 2 ** Math.max(0, attempt))
}
