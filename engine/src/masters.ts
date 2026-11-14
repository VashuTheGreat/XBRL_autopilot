/**
 * Masters (docs/14 Step 9): the company, auditor and signatory details as webXBRL's masters show them, read from and
 * written to the filing's own facts. No taxonomy knowledge of its own: the knowledge base's curated `masters` block
 * (src/services/engine_rules/curation/<kb>/masters.json) names the statements by ELR title, the value lists of
 * free-text elements, the extra format checks and the PAN ↔ name pairs; everything else comes from the taxonomy —
 *   a section's card    the statement's non-dimensional items, under their headings
 *   a section's grids   the statement's tables with a single typed axis (one row per typed member)
 *   a field's list      the element's own enumeration, else its curated vocabulary (offered, not enforced)
 *   a field's format    the taxonomy type's pattern, else a business rule's format assertion, else a curated format
 *   fill targets        other single-typed-axis tables reporting some of the same elements (same element, same meaning)
 * Master values are CY: they describe the company as it files.
 */
import { nondimAllowed } from './core/dimensions.js'
import { FORMATS } from './core/expr.js'
import type { Session } from './core/session.js'

export interface FieldFormat {
  /** FORMATS name, or the taxonomy type's name for a type pattern */
  name: string
  /** anchored regular expression source (safe to send to the renderer) */
  pattern: string
}

export interface MasterField {
  concept: string
  label: string
  /** engine data type: string, date, boolean, enum, token, decimal … */
  dataType: string
  /** the abstract the item sits under (the card's sub-heading); null for table columns */
  heading: string | null
  /** values to choose from; null = free entry */
  options: string[] | null
  /** true = only these values are valid (a taxonomy enumeration); false = suggestions (a curated vocabulary) */
  strictOptions: boolean
  format: FieldFormat | null
}

export interface MasterTable {
  tableId: string
  title: string
  axis: string
  elrUri: string
  columns: MasterField[]
}

export interface MasterSection {
  id: string
  title: string
  elrUris: string[]
  items: MasterField[]
  tables: MasterTable[]
}

export interface MasterRow {
  /** the typed member that identifies the row */
  member: string
  values: Record<string, string>
}

/** A table outside the masters that reports some of a master's elements: where "Fill from master" writes. */
export interface FillTarget {
  tableId: string
  title: string
  elrUri: string
  elrTitle: string
  /** the shared elements, in the target's column order */
  shared: string[]
}

export interface PanPair {
  pan: string
  category: string
  byCategory: Record<string, { name: string; holder: string }>
}

interface MastersCuration {
  sections: { id: string; elrTitle: string; items: boolean; tables: boolean }[]
  vocabularies: Record<string, string>
  formats: Record<string, string>
  panNames: PanPair[]
}

type Arc = { to: string }
type Table = { id: string; hypercube: string; presentationElr: string; lineItems: string[]; axes: { axis: string; typed?: boolean }[] }
type Rule = { status: string; subject?: string; ast?: { type?: string; assert?: { op?: string; format?: string } } }
export type MastersAuthority = {
  elrs: { uri: string; title: string; roots: string[] }[]
  tables: Table[]
  types: Record<string, { base?: string; enumerations?: string[]; pattern?: string; patterns?: string[] }>
  rules: { rules: Rule[]; masters?: MastersCuration }
  concept(q: string): { kind: string; type?: string } | null
  label(q: string): string
  dataType(q: string): string
  isMonetary(q: string): boolean
  isReportable(q: string): boolean
  enumerations(q: string): string[] | null
  presentationChildren(elr: string, from: string): Arc[]
  table(id: string): Table | null
  elr(uri: string): { title: string } | null
}
type View = {
  A: MastersAuthority
  filing: { all(): { concept: string; dims: { axis: string; typed?: string }[] }[] }
  getValue(q: string, scope: 'CY', dims: unknown[]): { value: string; nil?: boolean } | null
  openTable(id: string, scope: 'CY'): { slices: { axis: string; typed?: string }[][] }
  setValue(q: string, scope: 'CY', display: string): unknown
  setTableValue(id: string, scope: 'CY', dims: unknown[], q: string, display: string): unknown
  suggestTypedValue(id: string, scope: 'CY', axis: string): string
  removeSlice(id: string, scope: 'CY', dims: unknown[]): void
}

const curation = (A: MastersAuthority): MastersCuration =>
  A.rules.masters ?? { sections: [], vocabularies: {}, formats: {}, panNames: [] }

/** The value list of a field: its own enumeration (strict), else its curated vocabulary (suggestions). */
export function fieldOptions(A: MastersAuthority, q: string): { options: string[] | null; strict: boolean } {
  const own = A.enumerations(q)
  if (own) return { options: own, strict: true }
  const type = curation(A).vocabularies[q]
  return { options: type ? typeEnumerations(A, type) : null, strict: false }
}

function typeEnumerations(A: MastersAuthority, type: string): string[] | null {
  const seen = new Set<string>()
  for (let t: string | undefined = type; t && A.types[t] && !seen.has(t); t = A.types[t]!.base) {
    seen.add(t)
    if (A.types[t]!.enumerations) return A.types[t]!.enumerations!
  }
  return null
}

const RULE_FORMATS = new WeakMap<object, Map<string, string>>()
/** element → format name asserted by an executable business rule ("Should be valid PAN as per Income_tax_PAN format") */
function ruleFormats(A: MastersAuthority): Map<string, string> {
  let m = RULE_FORMATS.get(A)
  if (!m) {
    m = new Map()
    for (const r of A.rules.rules) {
      const name = r.ast?.assert?.op === 'format' ? r.ast.assert.format : undefined
      if (r.status === 'EXECUTABLE' && r.ast?.type === 'eachFact' && r.subject && name && name in FORMATS) m.set(r.subject, name)
    }
    RULE_FORMATS.set(A, m)
  }
  return m
}

/** The format a field's value must have: the taxonomy type's pattern, a rule's format assertion, or a curated one. */
export function fieldFormat(A: MastersAuthority, q: string): FieldFormat | null {
  const type = A.concept(q)?.type
  const facets = type ? A.types[type] : undefined
  const patterns = facets?.patterns ?? (facets?.pattern ? [facets.pattern] : [])
  if (type && patterns.length) return { name: type, pattern: `^(?:${patterns.join('|')})$` }
  const name = ruleFormats(A).get(q) ?? curation(A).formats[q]
  const re = name ? (FORMATS as Record<string, RegExp>)[name] : undefined
  return name && re ? { name, pattern: re.source } : null
}

function field(A: MastersAuthority, q: string, heading: string | null): MasterField {
  const { options, strict } = fieldOptions(A, q)
  return { concept: q, label: A.label(q), dataType: A.dataType(q), heading, options, strictOptions: strict, format: fieldFormat(A, q) }
}

const typedTable = (t: Table) => t.axes.length === 1 && t.axes[0]!.typed === true

/** The statement's non-dimensional items (not amounts), in presentation order, each under its nearest abstract. */
function cardItems(A: MastersAuthority, uri: string, roots: string[], into: Map<string, MasterField>): void {
  const walk = (q: string, heading: string | null): void => {
    const c = A.concept(q)
    if (!c || c.kind === 'hypercube') return
    if (c.kind === 'item' && A.isReportable(q) && !A.isMonetary(q) && nondimAllowed(A, q) && !into.has(q)) into.set(q, field(A, q, heading))
    const under = c.kind === 'abstract' ? A.label(q) : heading
    for (const a of A.presentationChildren(uri, q)) walk(a.to, under)
  }
  for (const r of roots) walk(r, null)
}

/** The Masters panel's sections for this taxonomy (empty when the knowledge base has no masters curation). */
export function masterSections(A: MastersAuthority): MasterSection[] {
  return curation(A).sections.map((sec) => {
    const elrs = A.elrs.filter((e) => e.title === sec.elrTitle)
    const items = new Map<string, MasterField>()
    const tables = new Map<string, MasterTable>()
    for (const e of elrs) {
      if (sec.items) cardItems(A, e.uri, e.roots, items)
      if (!sec.tables) continue
      for (const t of A.tables.filter((x) => x.presentationElr === e.uri && typedTable(x) && !tables.has(x.id))) {
        const columns = t.lineItems.filter((q) => A.isReportable(q)).map((q) => field(A, q, null))
        tables.set(t.id, { tableId: t.id, title: A.label(t.hypercube), axis: t.axes[0]!.axis, elrUri: e.uri, columns })
      }
    }
    return { id: sec.id, title: sec.elrTitle, elrUris: elrs.map((e) => e.uri), items: [...items.values()], tables: [...tables.values()] }
  })
}

const valueOf = (S: View, q: string, dims: unknown[]): string | null => {
  const f = S.getValue(q, 'CY', dims)
  return f && !f.nil ? f.value : null
}

/** The CY values of a card's items (only those with a value). */
export function masterItemValues(session: Session, items: MasterField[]): Record<string, string> {
  const S = session as unknown as View
  const out: Record<string, string> = {}
  for (const f of items) {
    const v = valueOf(S, f.concept, [])
    if (v !== null) out[f.concept] = v
  }
  return out
}

/** The CY rows of a master grid, one per typed member, in member order. */
export function masterTableRows(session: Session, table: Pick<MasterTable, 'tableId' | 'axis' | 'columns'>): MasterRow[] {
  const S = session as unknown as View
  return typedMembers(S, table.tableId, table.axis).map((member) => {
    const dims = [{ axis: table.axis, typed: member }]
    const values: Record<string, string> = {}
    for (const c of table.columns) {
      const v = valueOf(S, c.concept, dims)
      if (v !== null) values[c.concept] = v
    }
    return { member, values }
  })
}

function typedMembers(S: View, tableId: string, axis: string): string[] {
  let slices: { axis: string; typed?: string }[][]
  try {
    slices = S.openTable(tableId, 'CY').slices
  } catch {
    return [] // the table does not apply to this filing: no rows
  }
  const members = slices.map((dims) => dims.find((d) => d.axis === axis)?.typed).filter((m): m is string => m != null)
  return [...new Set(members)].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

/** Adds an empty row to a master grid: the next typed member in the axis's naming (Filing Manual §1.3.2(6)). */
export function nextMasterMember(session: Session, tableId: string, axis: string): string {
  return (session as unknown as View).suggestTypedValue(tableId, 'CY', axis)
}

/** Writes one cell of a master grid (an empty value clears it) through the Session's own checks. */
export function setMasterCell(session: Session, tableId: string, axis: string, member: string, concept: string, value: string): void {
  ;(session as unknown as View).setTableValue(tableId, 'CY', [{ axis, typed: member }], concept, value.trim())
}

/** Removes a row of a master grid (every CY fact of the member). */
export function removeMasterRow(session: Session, tableId: string, axis: string, member: string): void {
  ;(session as unknown as View).removeSlice(tableId, 'CY', [{ axis, typed: member }])
}

/** Writes one card item (an empty value clears it) through the Session's own checks. */
export function setMasterItem(session: Session, concept: string, value: string): void {
  ;(session as unknown as View).setValue(concept, 'CY', value.trim())
}

/** The tables outside the masters that report some of these elements, with the elements they share. */
export function fillTargets(A: MastersAuthority, concepts: Iterable<string>, exclude: Iterable<string> = []): FillTarget[] {
  const wanted = new Set(concepts)
  const skip = new Set(exclude)
  return A.tables
    .filter((t) => !skip.has(t.id) && typedTable(t))
    .map((t) => ({ t, shared: t.lineItems.filter((q) => wanted.has(q)) }))
    .filter((x) => x.shared.length > 0)
    .map(({ t, shared }) => ({ tableId: t.id, title: A.label(t.hypercube), elrUri: t.presentationElr, elrTitle: A.elr(t.presentationElr)?.title ?? '', shared }))
}

export interface FillResult {
  /** typed members added */
  added: string[]
  /** records already in the table (every shared value equal): not added again */
  skipped: number
}

/**
 * Copies master records into a table as new rows: each record's values of the table's line items, under the next
 * typed member. A record whose shared values a row already holds is skipped, so filling twice adds nothing.
 */
export function fillTableFromRecords(session: Session, tableId: string, records: Record<string, string>[]): FillResult {
  const S = session as unknown as View
  const t = S.A.table(tableId)
  if (!t || !typedTable(t)) throw new Error(`${tableId} is not a table with one typed axis`)
  const axis = t.axes[0]!.axis
  const columns = t.lineItems.filter((q) => S.A.isReportable(q))
  const existing = masterTableRows(session, { tableId, axis, columns: columns.map((concept) => ({ concept }) as MasterField) })
  const result: FillResult = { added: [], skipped: 0 }
  for (const record of records) {
    const values = columns.filter((q) => record[q]?.trim()).map((q) => [q, record[q]!.trim()] as const)
    if (!values.length) continue
    if (existing.some((row) => values.every(([q, v]) => row.values[q] === v))) {
      result.skipped++
      continue
    }
    const member = S.suggestTypedValue(tableId, 'CY', axis)
    for (const [q, v] of values) S.setTableValue(tableId, 'CY', [{ axis, typed: member }], q, v)
    existing.push({ member, values: Object.fromEntries(values) })
    result.added.push(member)
  }
  return result
}

/** The curated PAN ↔ name pairs whose PAN element is one of these (a card's or a grid's fields). */
export function panPairs(A: MastersAuthority, concepts: Iterable<string>): PanPair[] {
  const own = new Set(concepts)
  return curation(A).panNames.filter((p) => own.has(p.pan))
}
