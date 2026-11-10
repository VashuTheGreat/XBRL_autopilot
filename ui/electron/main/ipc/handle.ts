import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { IpcError, Result } from '@shared/ipc'
import { ValidationError } from '../services/errors'

export function toIpcError(err: unknown): IpcError {
  if (err instanceof ValidationError) return { kind: 'validation', message: err.message, problems: err.problems }
  return { kind: 'error', message: err instanceof Error ? err.message : String(err) }
}

/** Registers an invoke handler whose outcome is always a Result (never a thrown IPC error). */
export function handleResult<A extends unknown[], T>(
  channel: string,
  fn: (event: IpcMainInvokeEvent, ...args: A) => Promise<T> | T,
): void {
  ipcMain.handle(channel, async (event, ...args): Promise<Result<T>> => {
    try {
      return { ok: true, value: await fn(event, ...(args as A)) }
    } catch (err) {
      console.error(`[ipc] ${channel} failed:`, err)
      return { ok: false, error: toIpcError(err) }
    }
  })
}

/** For queries that cannot fail in normal operation. */
export function handleQuery<A extends unknown[], T>(channel: string, fn: (event: IpcMainInvokeEvent, ...args: A) => Promise<T> | T): void {
  ipcMain.handle(channel, (event, ...args) => fn(event, ...(args as A)))
}

/** Runtime guard for renderer-supplied strings. */
export function requireString(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v) throw new Error(`Invalid ${name}`)
  return v
}
