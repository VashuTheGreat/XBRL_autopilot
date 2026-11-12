import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { Authority } from '@xap/engine'
import type { TaxonomyId } from '@xap/engine/basics'
import type { AuthorityJson, AuthorityProvider, LoadedAuthority } from '../services/ports'

const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8')) as AuthorityJson

/**
 * An already assembled authority file (engine/authority/<taxonomy>.authority.json, joined from the two
 * knowledge-base files by `pnpm --filter @xap/engine assemble:authority`), for tests and tools that run without
 * the sidecar. Loaded once.
 */
export class FileAuthorityProvider implements AuthorityProvider {
  private cached: Promise<LoadedAuthority> | null = null

  constructor(
    private readonly file: string,
    private readonly taxonomyId: TaxonomyId = 'ci-2016',
  ) {}

  load(taxonomy: TaxonomyId = this.taxonomyId): Promise<LoadedAuthority> {
    if (taxonomy !== this.taxonomyId) return Promise.reject(new Error(`${this.file} holds the ${this.taxonomyId} authority, not ${taxonomy}`))
    this.cached ??= this.read().catch((err) => {
      this.cached = null // allow a retry after e.g. `assemble:authority`
      throw err
    })
    return this.cached
  }

  private async read(): Promise<LoadedAuthority> {
    if (!existsSync(this.file)) {
      throw new Error(`The ${this.taxonomyId} authority is missing (${this.file}). Run "pnpm --filter @xap/engine assemble:authority".`)
    }
    const json = await readJson(this.file)
    return { taxonomyId: this.taxonomyId, authority: new Authority(json), hash: (json.meta.authorityHash as string) ?? null }
  }
}
