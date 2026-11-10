import type { ProjectService } from './project-service'

/** Periodically writes recovery copies of unsaved work. The interval comes from settings and can change. */
export class AutosaveScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false

  constructor(
    private readonly projects: ProjectService,
    private readonly intervalSeconds: () => number,
    private readonly onError: (err: unknown) => void = (err) => console.error('[autosave]', err),
  ) {}

  start(): void {
    this.stop()
    this.timer = setInterval(() => void this.tick(), this.intervalSeconds() * 1000)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Also called on window blur. Never overlaps itself. */
  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      await this.projects.autosaveNow()
    } catch (err) {
      this.onError(err)
    } finally {
      this.running = false
    }
  }
}
