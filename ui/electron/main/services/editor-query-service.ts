/**
 * EditorQueryService: read-models for the right-hand editor (XBRL Form, XML) and the taxonomy browser.
 * Queries only; all changes go through MappingService / the engine session.
 */
import { indexFactLines, nondimAllowed } from '@xap/engine'
import type { ConceptHit, FormCell, FormRow, FormView, MappingView, XmlView } from '@shared/editor'
import type { CellRef } from '@shared/workbook'
import { ValidationError } from './errors'
import type { ProjectAccess } from './ports'

interface ConceptJson {
  kind?: string
  periodType?: 'instant' | 'duration' | null
  balance?: 'debit' | 'credit' | null
  labels?: Record<string, string>
}

interface ElrViewRow {
  kind: 'header' | 'item' | 'table'
  concept?: string
  tableId?: string
  depth: number
  label: string
  preferredLabel?: string | null
  dataType?: string
}

export class EditorQueryService {
  constructor(
    private readonly projects: ProjectAccess,
    private readonly mappings: () => MappingView[],
    private readonly today: () => string = () => new Date().toISOString().slice(0, 10),
  ) {}

  form(elrUri: string): FormView {
    const p = this.projects.project()
    const A = p.authority.authority
    const elr = A.elr(elrUri) as { code: string; title: string } | null
    if (!elr) throw new ValidationError(['Unknown statement.'])
    const view = p.session.elrView(elrUri) as { rows: ElrViewRow[]; tables: string[] }
    const byFact = new Map<string, MappingView>()
    for (const m of this.mappings()) if (m.factKey) byFact.set(m.factKey, m)
    const hasPy = p.periods().py !== null

    const cellFor = (concept: string, scope: 'CY' | 'PY', preferredLabel: string | null): FormCell => {
      const fact = p.session.getValue(concept, scope, [], preferredLabel) as { key: string } | null
      const m = fact ? byFact.get(fact.key) : undefined
      return {
        factKey: fact?.key ?? null,
        display: fact ? String(p.session.displayOf(fact)) : '',
        source: (m?.cell as CellRef | undefined) ?? null,
        mappingId: m?.id ?? null,
      }
    }

    const rows: FormRow[] = view.rows.map((r) => {
      if (r.kind !== 'item' || !r.concept) return { kind: r.kind, depth: r.depth, label: r.label, concept: r.concept, tableId: r.tableId }
      const pl = r.preferredLabel ?? null
      return {
        kind: 'item',
        depth: r.depth,
        label: r.label,
        concept: r.concept,
        dataType: r.dataType,
        cy: cellFor(r.concept, 'CY', pl),
        ...(hasPy ? { py: cellFor(r.concept, 'PY', pl) } : {}),
      }
    })
    return { elrUri, code: elr.code, title: elr.title, rows, tableCount: view.tables.length }
  }

  xml(): XmlView {
    const p = this.projects.project()
    const out = p.session.exportXml({ allowErrors: true, today: this.today() }) as {
      xml: string
      validated: boolean
      gate: { emit: { key: string; concept: string; period: unknown; dims: unknown[] }[]; summary: { errors: number } }
    }
    return {
      xml: out.xml,
      factLines: indexFactLines(out.xml, p.session.filing, out.gate.emit),
      validated: out.validated,
      errorCount: out.gate.summary.errors,
    }
  }

  /** Label/qname search over reportable elements; every word must match. Statement-level elements rank first. */
  searchConcepts(query: string, limit = 60): ConceptHit[] {
    const p = this.projects.project()
    const A = p.authority.authority
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return []
    const concepts = (A as unknown as { concepts: Record<string, ConceptJson> }).concepts
    const hits: { hit: ConceptHit; score: number }[] = []
    for (const [qname, c] of Object.entries(concepts)) {
      if (c.kind !== 'item' || !A.isReportable(qname)) continue
      const label = A.label(qname)
      const hay = `${label} ${qname}`.toLowerCase()
      if (!words.every((w) => hay.includes(w))) continue
      const nonDimensional = nondimAllowed(A, qname)
      const l = label.toLowerCase()
      const q = words.join(' ')
      const score = (l === q ? 100 : l.startsWith(q) ? 50 : l.includes(q) ? 20 : 0) + (nonDimensional ? 10 : 0) - label.length / 100
      hits.push({
        score,
        hit: {
          qname,
          label,
          dataType: A.dataType(qname),
          periodType: c.periodType ?? null,
          balance: c.balance ?? null,
          nonDimensional,
          elrCodes: (A.conceptElrs(qname) as string[]).map((u) => (A.elr(u) as { code: string } | null)?.code ?? '').filter(Boolean),
        },
      })
    }
    return hits.sort((a, b) => b.score - a.score || a.hit.label.localeCompare(b.hit.label)).slice(0, limit).map((h) => h.hit)
  }
}
