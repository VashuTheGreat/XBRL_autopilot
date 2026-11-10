/** Editor read-models and commands: mapping (Excel cell ↔ fact), XBRL Form, XML, taxonomy search. */
import type { CellRef } from './workbook'

export type Scope = 'CY' | 'PY'
export type MappingStatus = 'suggested' | 'approved' | 'rejected'
export type MappingOrigin = 'manual' | 'ai' | 'memory' | 'exact'

export interface DimRef {
  axis: string
  member?: string
  typed?: string
}

/** Persisted in the project's mapping.json (docs/03-project-file-axbrl.md). */
export interface MappingEntry {
  id: string
  cell: CellRef
  /** row label next to the cell when tagged (for review and AI memory) */
  label: string | null
  fact: { concept: string; scope: Scope; dims: DimRef[] }
  /** applied to the cell's number (e.g. an expense shown as a negative) */
  sign: 1 | -1
  origin: MappingOrigin
  confidence: number | null
  rationale?: string
  status: MappingStatus
}

/** MappingEntry plus derived, non-persisted info for the UI. */
export interface MappingView extends MappingEntry {
  conceptLabel: string
  factKey: string | null
  /** the value that went into the filing, as displayed */
  value: string | null
}

export interface TagCellInput {
  cell: CellRef
  concept: string
  /** omitted → inferred from the column header (CY/PY dates), else an error asks for it */
  scope?: Scope
  sign?: 1 | -1
}

/** A cell's amount as it goes into the filing (Excel float noise rounded to the statement's precision). */
export interface CellAmount {
  /** the number as stored in the workbook, e.g. "5443.466337358575" */
  exact: string
  /** canonical decimal used for the filing, e.g. "5443.47" */
  value: string
  places: number
  /** where `places` came from: the cell's number format, the filing's decimal places, or the typed text */
  placesFrom: 'format' | 'filing' | 'typed'
  rounded: boolean
}

/**
 * The period a value column stands for.
 * - remembered: the user chose it for this column (kept per sheet in mapping.json)
 * - header: a header above names the filing's CY or PY
 * - layout: no header; the sheet's first/second value column
 * - outside: a header names a period that is neither CY nor PY (3rd-year or stale header)
 * - unknown: nothing to go on
 */
export interface ColumnPeriod {
  /** "C" */
  column: string
  scope: Scope | null
  basis: 'remembered' | 'header' | 'layout' | 'outside' | 'unknown'
  /** shown to the user, e.g. column header “31.03.2014” */
  reason: string
}

export interface CellInfo {
  cell: CellRef
  amount: CellAmount | null
  column: ColumnPeriod
}

export interface ConceptHit {
  qname: string
  label: string
  dataType: string
  periodType: 'instant' | 'duration' | null
  balance: 'debit' | 'credit' | null
  /** the concept can be reported outside a dimensional table (taggable from a plain cell) */
  nonDimensional: boolean
  elrCodes: string[]
}

export interface FormCell {
  factKey: string | null
  display: string
  source: CellRef | null
  mappingId: string | null
}

export interface FormRow {
  kind: 'header' | 'item' | 'table'
  depth: number
  label: string
  concept?: string
  tableId?: string
  dataType?: string
  /** reported only inside a dimensional table: shown for orientation, not taggable from a plain cell */
  dimensional?: boolean
  cy?: FormCell
  py?: FormCell
}

export interface FormView {
  elrUri: string
  code: string
  title: string
  rows: FormRow[]
  /** dimensional tables in this ELR (editing them arrives in a later phase) */
  tableCount: number
}

export interface XmlView {
  xml: string
  /** fact key → 1-based line */
  factLines: Record<string, number>
  validated: boolean
  errorCount: number
}

export interface EditorRevision {
  /** bumps whenever facts or mappings change, so views know to refresh */
  revision: number
}
