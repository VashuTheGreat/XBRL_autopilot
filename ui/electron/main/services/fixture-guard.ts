/**
 * Fixture guard (ADR-0012): the repository's real client files (data/: Dixon, DGPL, HPL, Rebel …) must never reach an
 * AI service, not even from a developer's machine. A project whose workbook or imported XBRL instance is one of them
 * (same content, or same file name) gets no AI.
 *
 * The hashes are computed from data/ when the app starts and data/ exists (development). The packaged app has no
 * data/ folder, so there the guard is empty and never blocks anything.
 */
import { createHash } from 'node:crypto'
import type { AxbrlContent } from '../project/axbrl'
import type { FixtureGuard } from './ports'

/** Content digest: XML text without BOM and with LF line ends (an imported instance is kept as text); bytes otherwise. */
export function fixtureDigest(fileName: string, bytes: Uint8Array | string): string {
  const h = createHash('sha256')
  if (/\.xml$/i.test(fileName) || typeof bytes === 'string') {
    const text = typeof bytes === 'string' ? bytes : Buffer.from(bytes).toString('utf8')
    h.update(text.replace(/^﻿/, '').replace(/\r\n?/g, '\n'), 'utf8')
  } else {
    h.update(bytes)
  }
  return h.digest('hex')
}

export interface FixtureFile {
  name: string
  digest: string
}

export class HashFixtureGuard implements FixtureGuard {
  private readonly byDigest = new Map<string, string>()
  private readonly names = new Set<string>()
  private readonly memo = new Map<string, string | null>()

  constructor(files: FixtureFile[]) {
    for (const f of files) {
      this.byDigest.set(f.digest, f.name)
      this.names.add(f.name.toLowerCase())
    }
  }

  get size(): number {
    return this.byDigest.size
  }

  match(content: AxbrlContent): string | null {
    if (!this.byDigest.size) return null
    const byName = [
      ...Object.values(content.manifest.sources ?? {}).map((s) => s.fileName),
      content.manifest.importedFrom?.fileName,
    ].find((n) => n && this.names.has(n.toLowerCase()))
    if (byName) return byName
    // hashing an 8 MB workbook on every status check would be wasteful: memoised by names and sizes
    const key = [
      ...Object.entries(content.sources).map(([n, b]) => `s:${n}:${b.byteLength}`),
      ...Object.entries(content.imports).map(([n, t]) => `i:${n}:${t.length}`),
    ].join('|')
    if (this.memo.has(key)) return this.memo.get(key) ?? null
    let hit: string | null = null
    for (const [name, bytes] of Object.entries(content.sources)) hit ??= this.byDigest.get(fixtureDigest(name, bytes)) ?? null
    for (const [name, text] of Object.entries(content.imports)) if (/\.xml$/i.test(name)) hit ??= this.byDigest.get(fixtureDigest(name, text)) ?? null
    this.memo.set(key, hit)
    return hit
  }
}

export const NO_FIXTURE_GUARD: FixtureGuard = { match: () => null }
