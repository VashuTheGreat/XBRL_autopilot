/**
 * Logging must never take the app down. With stdout/stderr redirected to a file, console.log writes synchronously, and
 * a full disk (ENOSPC) or a closed pipe (EPIPE) made it throw inside the sidecar log listener: an uncaught exception
 * in the main process (seen 2026-11-11, "no space left on device, write"). After hardenConsole(), a failed log write is
 * dropped; the app keeps running.
 */
type Writer = (...args: unknown[]) => void

const METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const

export function hardenConsole(target: Console = console, streams: NodeJS.WriteStream[] = [process.stdout, process.stderr]): void {
  for (const m of METHODS) {
    const original = target[m].bind(target) as Writer
    target[m] = ((...args: unknown[]) => {
      try {
        original(...args)
      } catch {
        // the log line is lost, the app is not
      }
    }) as Console[typeof m]
  }
  // asynchronous write failures arrive as 'error' events; without a listener they are uncaught
  for (const s of streams) s?.on?.('error', () => {})
}
