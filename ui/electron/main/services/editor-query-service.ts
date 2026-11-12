/**
 * EditorQueryService: read-models for the right-hand editor (XBRL Form, XML).
 * The Form's *structure* (rows, labels, order, depth) comes from the knowledge base through the FastAPI /tree route
 * (TaxonomyCatalog). The engine only supplies the *values* (facts, CY/PY, source cells) and whether an element can be
 * reported outside a dimensional table. Queries only; changes go through MappingService / the engine session.
 */
import { dimKey, indexFactLines, nondimAllowed } from '@xap/engine'
import { displayLabel, type DimRef, type FormCell, type FormRow, type FormTable, type FormTableColumn, type FormView, type MappingView, type Scope, type XmlView } from '@shared/editor'
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
    for (const m of this.mappings()) for (const k of m.factKeys ?? []) byFact.set(k, m)
    const hasPy = p.periods().py !== null

    const cellFor = (concept: string, scope: Scope, dims: DimRef[] = [], preferredLabel: string | null = null): FormCell => {
      const fact = p.session.getValue(concept, scope, dims, preferredLabel) as { key: string } | null
      const m = fact ? byFact.get(fact.key) : undefined
      return {
        factKey: fact?.key ?? null,
        display: fact ? String(p.session.displayOf(fact)) : '',
        source: (m?.cell as CellRef | undefined) ?? null,
        mappingId: m?.id ?? null,
        ...(m && fact && m.factKey !== fact.key ? { also: true } : {}),
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
    return { elrUri, code: elr.code, title: elr.title, rows, tableCount, tables: this.tables(elrUri, hasPy, cellFor) }
  }

  /**
   * The ELR's dimensional tables with their values: a column per member combination that holds a value, per year
   * (Session.openTable), a row per line item (the engine's table view, from the knowledge-base authority).
   */
  private tables(elrUri: string, hasPy: boolean, cellFor: (q: string, s: Scope, d: DimRef[], pl: string | null) => FormCell): FormTable[] {
    const p = this.projects.project()
    const A = p.authority.authority as unknown as { tables: { id: string; presentationElr: string; axes: unknown[] }[]; label(q: string): string }
    const S = p.session as unknown as {
      tableView(id: string): { title: string; lineItems: { concept: string; label: string; depth: number; abstract: boolean; preferredLabel: string | null }[] }
      openTable(id: string, scope: Scope): { slices: DimRef[][] }
    }
    const out: FormTable[] = []
    for (const t of A.tables.filter((x) => x.presentationElr === elrUri && x.axes.length)) {
      const view = S.tableView(t.id)
      const columns: FormTableColumn[] = []
      let closed = true
      for (const scope of (hasPy ? ['CY', 'PY'] : ['CY']) as Scope[]) {
        let slices: DimRef[][]
        try {
          slices = S.openTable(t.id, scope).slices
          closed = false
        } catch {
          continue // the table isn't applicable for that year
        }
        for (const dims of slices) {
          columns.push({ key: `${scope}|${dimKey(dims)}`, scope, dims, label: dims.map((d) => (d.member ? displayLabel(A.label(d.member)) : String(d.typed))).join(' · ') || 'Total' })
        }
      }
      const rows = view.lineItems.map((l) => ({
        concept: l.concept,
        label: l.label,
        depth: l.depth,
        abstract: l.abstract,
        preferredLabel: l.preferredLabel ?? null,
        cells: l.abstract ? {} : Object.fromEntries(columns.map((c) => [c.key, cellFor(l.concept, c.scope, c.dims, l.preferredLabel ?? null)])),
      }))
      out.push({ tableId: t.id, title: displayLabel(view.title), closed, columns, rows })
    }
    return out
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
