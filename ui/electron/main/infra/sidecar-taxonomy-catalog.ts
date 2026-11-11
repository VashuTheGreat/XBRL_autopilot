/**
 * TaxonomyCatalog over the sidecar's FastAPI routes (/api/v1/taxonomies/..., backed by knowledge_base/*.json).
 * Waits for the sidecar, unwraps the {data, success, message} envelope, caches the ELR lists.
 */
import type { TaxonomyId } from '@xap/engine/basics'
import type { ElrInfo } from '@shared/project'
import type { CatalogConcept, ElrTree, SidecarClient, TaxonomyCatalog } from '../services/ports'
import { sidecarCall } from './sidecar-call'

/** App taxonomy ids → knowledge-base ids used by the FastAPI routes. */
export const KB_TAXONOMY_ID: Record<TaxonomyId, string> = {
  'ci-2016': 'ci_taxonomy',
  'ind-as-2017': 'ind_as_taxonomy',
  'costing-2019': 'costing_taxonomy',
}

export class SidecarTaxonomyCatalog implements TaxonomyCatalog {
  private readonly elrCache = new Map<string, Promise<ElrInfo[]>>()
  private readonly treeCache = new Map<string, Promise<ElrTree>>()

  constructor(
    private readonly sidecar: SidecarClient,
    private readonly readyTimeoutMs = 120_000,
  ) {}

  elrs(taxonomy: TaxonomyId): Promise<ElrInfo[]> {
    const kb = KB_TAXONOMY_ID[taxonomy]
    let cached = this.elrCache.get(kb)
    if (!cached) {
      cached = this.get<ElrInfo[]>(`/api/v1/taxonomies/${kb}/elrs`).then((list) =>
        list.map(({ uri, code, title, group }) => ({ uri, code, title, group })),
      )
      this.elrCache.set(kb, cached)
      cached.catch(() => this.elrCache.delete(kb)) // retry after a sidecar restart
    }
    return cached
  }

  elrTree(taxonomy: TaxonomyId, code: string): Promise<ElrTree> {
    const kb = KB_TAXONOMY_ID[taxonomy]
    const key = `${kb}|${code}`
    let cached = this.treeCache.get(key)
    if (!cached) {
      cached = this.get<ElrTree>(`/api/v1/taxonomies/${kb}/elrs/${encodeURIComponent(code)}/tree`)
      this.treeCache.set(key, cached)
      cached.catch(() => this.treeCache.delete(key))
    }
    return cached
  }

  async searchConcepts(taxonomy: TaxonomyId, query: string, limit: number): Promise<CatalogConcept[]> {
    const kb = KB_TAXONOMY_ID[taxonomy]
    const qs = new URLSearchParams({ q: query, summary: 'true', limit: String(limit) })
    const res = await this.get<{ total: number; items: CatalogConcept[] }>(`/api/v1/taxonomies/${kb}/concepts/search?${qs}`)
    return res.items
  }

  private get<T>(path: string): Promise<T> {
    return sidecarCall<T>(this.sidecar, 'GET', path, { readyTimeoutMs: this.readyTimeoutMs, what: 'Taxonomy service' })
  }
}
