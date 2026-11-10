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
