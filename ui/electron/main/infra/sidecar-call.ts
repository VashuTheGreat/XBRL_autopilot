/** Calls a sidecar route and unwraps its {data, success, message} envelope (api/responses.py). Shared by the adapters. */
import type { HttpMethod } from '@shared/ipc'
import type { SidecarClient } from '../services/ports'

interface Envelope<T> {
  data: T
  success: boolean
  message: string
}

/** A route answered with an error; `status` lets adapters tell "not available" (404) from a failure. */
export class SidecarCallError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'SidecarCallError'
  }
}

export async function sidecarCall<T>(
  sidecar: SidecarClient,
  method: HttpMethod,
  path: string,
  { body, readyTimeoutMs = 120_000, what = 'AI engine' }: { body?: unknown; readyTimeoutMs?: number; what?: string } = {},
): Promise<T> {
  await sidecar.whenReady(readyTimeoutMs)
  const res = await sidecar.request<Envelope<T>>(method, path, body)
  if (res.status !== 200 || !res.data?.success) throw new SidecarCallError(res.data?.message || `${what} error (${res.status})`, res.status)
  return res.data.data
}
