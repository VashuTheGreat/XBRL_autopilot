import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { Authority } from '@xap/engine'
import type { AuthorityProvider, LoadedAuthority } from '../services/ports'

interface AuthorityJson {
  meta?: { authorityHash?: string }
}

/** Loads engine/authority/ci-2016.authority.json (dev) or resources/authority/… (packaged), once. */
export class FileAuthorityProvider implements AuthorityProvider {
  private cached: Promise<LoadedAuthority> | null = null

  constructor(private readonly file: string) {}

  load(): Promise<LoadedAuthority> {
    this.cached ??= this.read().catch((err) => {
      this.cached = null // allow a retry after e.g. `compile:authority`
      throw err
    })
    return this.cached
  }

  private async read(): Promise<LoadedAuthority> {
    if (!existsSync(this.file)) {
      throw new Error(
        `The C&I 2016 taxonomy authority is missing (${this.file}). Run "pnpm --filter @xap/engine compile:authority".`,
      )
    }
    const json = JSON.parse(await readFile(this.file, 'utf8')) as AuthorityJson
    return { taxonomyId: 'ci-2016', authority: new Authority(json), hash: json.meta?.authorityHash ?? null }
  }
}
