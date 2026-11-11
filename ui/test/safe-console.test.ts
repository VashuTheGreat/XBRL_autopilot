/** A failed log write (full disk: ENOSPC, closed pipe: EPIPE) must never crash the main process. */
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { hardenConsole } from '../electron/main/util/safe-console'

describe('hardenConsole', () => {
  it('drops a log line whose write throws, and keeps logging afterwards', () => {
    const lines: string[] = []
    let full = true
    const write = (...a: unknown[]) => {
      if (full) throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' })
      lines.push(a.join(' '))
    }
    const fake = { log: write, info: write, warn: write, error: write, debug: write } as unknown as Console
    const stream = new EventEmitter() as unknown as NodeJS.WriteStream
    hardenConsole(fake, [stream])
    expect(() => fake.log('[sidecar:stdout] GET /api/v1/taxonomies/ci_taxonomy/elrs/200200/tree')).not.toThrow()
    expect(() => fake.error('[ipc] failed')).not.toThrow()
    full = false
    fake.log('disk freed')
    expect(lines).toEqual(['disk freed'])
    // an asynchronous EPIPE on the stream is no longer an uncaught 'error' event
    expect(() => (stream as unknown as EventEmitter).emit('error', new Error('EPIPE'))).not.toThrow()
  })
})
