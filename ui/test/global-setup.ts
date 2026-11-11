/**
 * Every temporary folder the tests make (mkdtempSync(join(tmpdir(), 'xap-…'))) goes into one folder per run, removed
 * when the run ends. Before this, each `pnpm test` left ~70 folders in %TEMP% (870 of them, 1.2 GB, on 2026-11-11).
 * os.tmpdir() reads TEMP / TMP / TMPDIR at each call, and the workers start after this setup, so they inherit it.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export default function setup(): () => void {
  const run = mkdtempSync(join(tmpdir(), 'xap-test-run-'))
  for (const k of ['TEMP', 'TMP', 'TMPDIR']) process.env[k] = run
  return () => {
    try {
      rmSync(run, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
    } catch {
      // a file still held by a just-stopped sidecar on Windows: the folder is small and in %TEMP%
    }
  }
}
