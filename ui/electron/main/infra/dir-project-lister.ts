import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { AXBRL_EXTENSION, readManifest } from '../project/axbrl'
import type { ProjectFileLister } from '../services/ports'

/** The .axbrl files directly in a folder (not recursive; a missing folder lists nothing). */
export class DirProjectLister implements ProjectFileLister {
  async list(dir: string) {
    if (!existsSync(dir)) return []
    const names = (await readdir(dir)).filter((n) => n.toLowerCase().endsWith(AXBRL_EXTENSION))
    return Promise.all(names.map(async (n) => ({ path: join(dir, n), manifest: await readManifest(join(dir, n)) })))
  }
}
