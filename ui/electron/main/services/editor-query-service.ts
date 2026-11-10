/**
 * EditorQueryService: read-models for the right-hand editor (XBRL Form, XML).
 * The Form's *structure* (rows, labels, order, depth) comes from the knowledge base through the FastAPI /tree route
 * (TaxonomyCatalog). The engine only supplies the *values* (facts, CY/PY, source cells) and whether an element can be
 * reported outside a dimensional table. Queries only; changes go through MappingService / the engine session.
 */
import { indexFactLines, nondimAllowed } from '@xap/engine'
import type { FormCell, FormRow, FormView, MappingView, XmlView } from '@shared/editor'
import type { CellRef } from '@shared/workbook'
import { ValidationError } from './errors'
import type { ElrTreeNode, ProjectAccess, TaxonomyCatalog } from './ports'

/** Presentation-tree nodes that are structure, not reportable values (XBRL dimensional constructs). */
const STRUCTURAL = /\[(table|axis|member|domain|line items)\]$/i

export class EditorQueryService {
  constructor(
    private readonly projects: ProjectAccess,
    private readonly mappings: () => MappingView[],
    private readonly catalog: TaxonomyCatalog,
    private readonly today: () => string = () => new Date().toISOString().slice(0, 10),
  ) {}

  async form(elrUri: string): Promise<FormView> {
    const p = this.projects.project()
    const taxonomy = p.authority.taxonomyId
    const elr = (await this.catalog.elrs(taxonomy)).find((e) => e.uri === elrUri)
    if (!elr) throw new ValidationError(['Unknown statement.'])
    const tree = await this.catalog.elrTree(taxonomy, elr.code)

    const A = p.authority.authority
    const byFact = new Map<string, MappingView>()
    for (const m of this.mappings()) if (m.factKey) byFact.set(m.factKey, m)
    const hasPy = p.periods().py !== null

    const cellFor = (concept: string, scope: 'CY' | 'PY'): FormCell => {
      const fact = p.session.getValue(concept, scope, []) as { key: string } | null
      const m = fact ? byFact.get(fact.key) : undefined
      return {
        factKey: fact?.key ?? null,
        display: fact ? String(p.session.displayOf(fact)) : '',
        source: (m?.cell as CellRef | undefined) ?? null,
        mappingId: m?.id ?? null,
      }
    }

    const rows: FormRow[] = []
    let tableCount = 0
    const visit = (n: ElrTreeNode, depth: number) => {
      if (/\[table\]$/i.test(n.label)) tableCount++
      if (n.abstract || STRUCTURAL.test(n.label)) {
        rows.push({ kind: /\[table\]$/i.test(n.label) ? 'table' : 'header', depth, label: n.label, concept: n.qname })
      } else if (A.has(n.qname) && nondimAllowed(A, n.qname)) {
        rows.push({
          kind: 'item',
          depth,
          label: n.label,
          concept: n.qname,
          dataType: A.dataType(n.qname),
          cy: cellFor(n.qname, 'CY'),
          ...(hasPy ? { py: cellFor(n.qname, 'PY') } : {}),
        })
      } else {
        // reported only inside a dimensional table (or unknown to the engine): shown, not editable here
        rows.push({ kind: 'item', depth, label: n.label, concept: n.qname, dimensional: true })
      }
      for (const child of n.children) visit(child, depth + 1)
    }
    for (const root of tree.tree) visit(root, 0)
    return { elrUri, code: elr.code, title: elr.title, rows, tableCount }
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
}
