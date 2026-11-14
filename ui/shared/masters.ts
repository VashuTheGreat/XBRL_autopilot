/** Masters panel (docs/14 Step 9): company card, auditor and signatory grids, the master library, fill from master. */
import { formatProblem, panNameProblems, type FormatSpec } from '@xap/engine/basics'

export interface MasterFieldView {
  concept: string
  label: string
  dataType: string
  /** the card's sub-heading (null for grid columns) */
  heading: string | null
  options: string[] | null
  /** true = only these values (a taxonomy enumeration); false = suggestions (the designation list) */
  strictOptions: boolean
  format: FormatSpec | null
}

/** "The auditor's name must match the PAN": which name the PAN belongs to, per category value. */
export interface PanPairView {
  pan: string
  category: string
  byCategory: Record<string, { name: string; holder: string }>
}

/** A table elsewhere in the filing that reports some of a master's elements: where "Fill from master" writes. */
export interface FillTargetView {
  tableId: string
  title: string
  elrUri: string
  elrTitle: string
  /** labels of the elements it takes from the master */
  shared: string[]
}

export interface MasterRowView {
  member: string
  /** concept → CY value */
  values: Record<string, string>
}

export interface MasterGridView {
  tableId: string
  title: string
  axis: string
  elrUri: string
  columns: MasterFieldView[]
  rows: MasterRowView[]
  panPairs: PanPairView[]
  /** where this grid's rows can be filled into */
  targets: FillTargetView[]
  /** the library kind of this grid's records */
  libraryKind: string
}

export interface MasterSectionView {
  id: string
  title: string
  elrUris: string[]
  items: MasterFieldView[]
  /** concept → CY value of the card's items */
  values: Record<string, string>
  grids: MasterGridView[]
  /** where the card's values can be filled into (the group-company tables, for the company) */
  targets: FillTargetView[]
  /** the library kind of the card's record */
  libraryKind: string
}

/** A saved master (a company, an auditor, a director …), reused across filings. Values by element local name. */
export interface LibraryRecord {
  id: string
  kind: string
  title: string
  values: Record<string, string>
  savedAt: string
}

export interface MastersView {
  sections: MasterSectionView[]
  library: LibraryRecord[]
}

export interface SetMasterItemInput {
  concept: string
  value: string
}

export interface SetMasterCellInput {
  tableId: string
  member: string
  concept: string
  value: string
}

export interface MasterRowRef {
  tableId: string
  member: string
}

/** Where fill records come from: rows of a master grid of this filing, or saved library records. */
export type FillSource = { kind: 'rows'; tableId: string; members: string[] } | { kind: 'library'; ids: string[] }

export interface FillFromMasterInput {
  /** the table to fill (a master grid itself, or a fill target) */
  tableId: string
  from: FillSource
}

export interface FillFromMasterResult {
  added: number
  skipped: number
}

/** What to save to the library: the card of a section, or one row of a grid. */
export type SaveMasterInput = { sectionId: string } | MasterRowRef

/** The library kind of a section card / a grid: stable across taxonomies (section id, hypercube local name). */
export const cardKind = (sectionId: string) => `card:${sectionId}`
export const gridKind = (tableId: string) => `table:${tableId.replace(/^[^:]*:/, '')}`

/** A field's live problems: its format, and for a PAN the name it belongs to (by the row's category). */
export function fieldProblems(field: MasterFieldView, values: Record<string, string>, pairs: PanPairView[]): string[] {
  const value = values[field.concept] ?? ''
  const out: string[] = []
  const format = formatProblem(field.format, value)
  if (format) out.push(format)
  if (field.strictOptions && field.options && value && !field.options.includes(value)) out.push('Choose one of the listed values.')
  for (const pair of pairs.filter((p) => p.pan === field.concept)) {
    const target = pair.byCategory[values[pair.category] ?? '']
    const name = target ? values[target.name] : undefined
    if (target && name && !format) out.push(...panNameProblems(value, name, target.holder))
  }
  return out
}

/** The name elements a PAN check reads: these always show the "exactly as on the PAN" reminder. */
export function panNameConcepts(pairs: PanPairView[]): Set<string> {
  return new Set(pairs.flatMap((p) => Object.values(p.byCategory).map((c) => c.name)))
}

/** The short title of a record: its first values, as the user would recognise it. */
export function recordTitle(values: Record<string, string>, order: string[]): string {
  const first = order.map((q) => values[q]).filter((v): v is string => !!v?.trim())
  return first.slice(0, 2).join(' · ') || 'Untitled'
}
