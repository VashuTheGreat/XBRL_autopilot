/** TaxonomyAuthoritySource over the sidecar route GET /api/v1/taxonomies/{id}/authority (knowledge_base). */
import type { TaxonomyId } from '@xap/engine/basics'
import type { AuthorityJson, SidecarClient, TaxonomyAuthoritySource } from '../services/ports'
import { sidecarCall } from './sidecar-call'
import { KB_TAXONOMY_ID } from './sidecar-taxonomy-catalog'

export class SidecarAuthoritySource implements TaxonomyAuthoritySource {
  constructor(
    private readonly sidecar: SidecarClient,
    private readonly readyTimeoutMs = 120_000,
  ) {}

  taxonomyAuthority(taxonomy: TaxonomyId): Promise<AuthorityJson> {
    return sidecarCall<AuthorityJson>(this.sidecar, 'GET', `/api/v1/taxonomies/${KB_TAXONOMY_ID[taxonomy]}/authority`, {
      readyTimeoutMs: this.readyTimeoutMs,
      what: 'Taxonomy service',
    })
  }
}
