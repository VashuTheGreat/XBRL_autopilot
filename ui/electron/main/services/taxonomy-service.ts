/**
 * TaxonomyService: taxonomy browsing for the UI (statement tree, element search).
 * Source of truth is the knowledge base behind the FastAPI routes (TaxonomyCatalog). The engine only adds what the
 * knowledge base doesn't know: whether an element can be tagged from a plain cell (outside a dimensional table).
 */
import { nondimAllowed } from '@xap/engine'
import type { ConceptHit } from '@shared/editor'
import type { ElrInfo } from '@shared/project'
import type { ProjectAccess, TaxonomyCatalog } from './ports'

export class TaxonomyService {
  constructor(
    private readonly projects: ProjectAccess,
    private readonly catalog: TaxonomyCatalog,
  ) {}

  elrs(): Promise<ElrInfo[]> {
    return this.catalog.elrs(this.projects.project().authority.taxonomyId)
  }

  async searchConcepts(query: string, limit = 60): Promise<ConceptHit[]> {
    const p = this.projects.project()
    const q = query.trim()
    if (q.length < 2) return []
    const A = p.authority.authority
    const items = await this.catalog.searchConcepts(p.authority.taxonomyId, q, limit)
    return items.map((c) => {
      const known = A.has(c.qname)
      return {
        qname: c.qname,
        label: c.label,
        dataType: known ? A.dataType(c.qname) : (c.type ?? ''),
        periodType: c.periodType,
        balance: c.balance,
        nonDimensional: known && nondimAllowed(A, c.qname),
        elrCodes: c.elrCodes,
      }
    })
  }
}
