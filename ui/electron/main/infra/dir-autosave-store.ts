import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readAxbrl, readManifest, removeQuietly, writeAxbrl, type AxbrlContent } from '../project/axbrl'
import type { AutosaveEntry, AutosaveStore } from '../services/ports'

const SAFE_ID = /^[a-zA-Z0-9-]{1,64}$/

/**
 * Autosave copies in one directory: <id>.axbrl plus <id>.json ({ originalPath, savedAt }).
 * Ids are validated so a renderer-supplied id can never escape the directory.
 */
export class DirAutosaveStore implements AutosaveStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
  }

  private paths(id: string) {
    if (!SAFE_ID.test(id)) throw new Error(`Invalid autosave id: ${id}`)
    return { file: join(this.dir, `${id}.axbrl`), meta: join(this.dir, `${id}.json`) }
  }

  async write(id: string, content: AxbrlContent, originalPath: string | null): Promise<void> {
    const p = this.paths(id)
    await writeAxbrl(p.file, content)
    await removeQuietly(`${p.file}.bak`) // one generation is enough for recovery copies
    await writeFile(p.meta, JSON.stringify({ originalPath, savedAt: new Date().toISOString() }))
  }

  async list(): Promise<AutosaveEntry[]> {
    if (!existsSync(this.dir)) return []
    const out: AutosaveEntry[] = []
    for (const name of readdirSync(this.dir).filter((n) => n.endsWith('.axbrl'))) {
      const id = name.slice(0, -'.axbrl'.length)
      if (!SAFE_ID.test(id)) continue
      const p = this.paths(id)
      const manifest = await readManifest(p.file)
      if (!manifest) continue
      const meta = existsSync(p.meta) ? (JSON.parse(await readFile(p.meta, 'utf8')) as { originalPath: string | null; savedAt: string }) : null
      out.push({ id, manifest, originalPath: meta?.originalPath ?? null, savedAt: meta?.savedAt ?? manifest.updatedAt })
    }
    return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  }

  async read(id: string): Promise<{ content: AxbrlContent; originalPath: string | null }> {
    const p = this.paths(id)
    const { content } = await readAxbrl(p.file)
    const meta = existsSync(p.meta) ? (JSON.parse(await readFile(p.meta, 'utf8')) as { originalPath: string | null }) : null
    return { content, originalPath: meta?.originalPath ?? null }
  }

  async remove(id: string): Promise<void> {
    const p = this.paths(id)
    await Promise.all([removeQuietly(p.file), removeQuietly(p.meta), removeQuietly(`${p.file}.tmp`)])
  }
}
