import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WritableDirProbe } from '../services/ports'

/** Real check: create the directory, then write and delete a probe file (ACLs, read-only media). */
export class FsWritableDirProbe implements WritableDirProbe {
  ensureWritable(dir: string): boolean {
    const probe = join(dir, `.xap-write-probe-${process.pid}`)
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(probe, '')
      rmSync(probe, { force: true })
      return true
    } catch {
      return false
    }
  }
}
