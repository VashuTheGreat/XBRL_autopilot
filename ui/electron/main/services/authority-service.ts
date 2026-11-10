/**
 * The engine authority of each taxonomy, assembled from its two halves (ADR-0010): the taxonomy authority from
 * the knowledge base (sidecar route) and the compiled business rules. Electron-free; cached per taxonomy, and a
 * failed load is retried on the next call (e.g. after a sidecar restart).
 */
import { assembleAuthority, Authority } from '@xap/engine'
import type { TaxonomyId } from '@xap/engine/basics'
import type { AuthorityProvider, LoadedAuthority, RuleBundleSource, TaxonomyAuthoritySource } from './ports'

export class AuthorityService implements AuthorityProvider {
  private readonly cache = new Map<TaxonomyId, Promise<LoadedAuthority>>()

  constructor(
    private readonly taxonomies: TaxonomyAuthoritySource,
    private readonly rules: RuleBundleSource,
  ) {}

  load(taxonomy: TaxonomyId): Promise<LoadedAuthority> {
    let cached = this.cache.get(taxonomy)
    if (!cached) {
      cached = this.assemble(taxonomy)
      this.cache.set(taxonomy, cached)
      cached.catch(() => this.cache.delete(taxonomy))
    }
    return cached
  }

  private async assemble(taxonomy: TaxonomyId): Promise<LoadedAuthority> {
    const [tax, rules] = await Promise.all([this.taxonomies.taxonomyAuthority(taxonomy), this.rules.rules(taxonomy)])
    const json = assembleAuthority(tax, rules) as { meta: { authorityHash?: string } }
    return { taxonomyId: taxonomy, authority: new Authority(json), hash: json.meta.authorityHash ?? null }
  }
}
