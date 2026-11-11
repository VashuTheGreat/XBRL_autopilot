/** Editor read-models and commands: mapping (Excel cell ↔ fact), XBRL Form, XML, taxonomy search. */
import type { CellRef } from './workbook'

export type Scope = 'CY' | 'PY'
export type MappingStatus = 'suggested' | 'approved' | 'rejected'
/**
 * who chose the concept: the user, or auto-tagging's evidence (memory, exact label, lexical match, AI rerank, a table
 * block matched to a taxonomy table)
 */
export type MappingOrigin = 'manual' | 'ai' | 'memory' | 'exact' | 'lexical' | 'table'

export interface DimRef {
  axis: string
  member?: string
  typed?: string
}

/**
 * The fact a cell is tagged to. A table fact (dims) names its table; `preferredLabel` matters for a table's opening
 * balance row (periodStartLabel), where it decides the period.
 */
export interface MappedFact {
  concept: string
  scope: Scope
  dims: DimRef[]
  tableId?: string | null
  preferredLabel?: string | null
}

/** "Computer equipments [Member]" → "Computer equipments": the taxonomy's structural suffix, dropped for display. */
export function displayLabel(label: string): string {
  return label.replace(/\s*\[(member|table|axis|domain|line items|abstract)\]\s*$/i, '')
}

/** Persisted in the project's mapping.json (docs/03-project-file-axbrl.md). */
export interface MappingEntry {
  id: string
  cell: CellRef
  /** row label next to the cell when tagged (for review and AI memory) */
  label: string | null
  fact: MappedFact
  /**
   * "Also reported as" (ADR-0013): the same figure filed as further facts, e.g. a balance-sheet line that is also
   * a table's member column. They follow the cell on every value change and go when the cell is untagged.
   */
  also?: MappedFact[]
  /** the table block that created this entry (mapping.json `blocks`) */
  blockId?: string
  /** applied to the cell's number (e.g. an expense shown as a negative) */
  sign: 1 | -1
  origin: MappingOrigin
  confidence: number | null
  rationale?: string
  /** an auto-tagging suggestion's runner-up elements */
  alternatives?: SuggestionAlternative[]
  /**
   * "Also reported as" facts auto-tagging proposes for this cell (e.g. share capital under the one class of shares).
   * Not filed: each is accepted (→ `also`) or rejected one by one, never in bulk.
   */
  alsoSuggested?: SuggestedAlso[]
  status: MappingStatus
}

export interface SuggestionAlternative {
  concept: string
  label: string
  score: number
}

/** A suggested "also reported as" fact: the fact, how sure the tagger is and why. */
export interface SuggestedAlso extends MappedFact {
  confidence: number
  reason?: string
}

/** What one auto-tagging run found (suggestions are stored as mapping entries with status 'suggested'). */
export interface AutoTagSummary {
  suggested: number
  /** suggestions not stored: the cell or the fact is already tagged, or the user rejected it before */
  skipped: number
  /** table blocks suggested (mapping.json `blockSuggestions`) */
  blocks: number
  sheets: { workbook: string; sheet: string; kind: string; rows: number; note: string | null }[]
  llmUsed: boolean
}

export interface AcceptAllResult {
  accepted: number
  /** table blocks applied (their cells are counted in `cells`) */
  blocks: number
  /** table cells tagged by those blocks */
  cells: number
  /** suggestions that could not be tagged (they stay suggested), with the reason */
  problems: string[]
}

/**
 * An auto-tagging table suggestion (ADR-0013): an Excel range mapped to one taxonomy table, in the shape "Map as
 * table" takes. Persisted in mapping.json `blockSuggestions`; nothing is tagged until it is accepted.
 */
export interface BlockSuggestion extends TableBlockInput {
  id: string
  tableTitle: string
  confidence: number
  /** cells the tagger planned as table values */
  cellCount: number
  status: 'suggested' | 'rejected'
}

/** MappingEntry plus derived, non-persisted info for the UI. */
export interface MappingView extends MappingEntry {
  conceptLabel: string
  /**
   * the statements / notes (ELR URIs) that show the element, by code: where the Form jumps when the cell is selected.
   * A table fact: its table's statement / note only.
   */
  elrUris: string[]
  factKey: string | null
  /** the main fact and the "also reported as" facts: every fact this cell supplies (for linkage) */
  factKeys: string[]
  /** the value that went into the filing, as displayed */
  value: string | null
  alsoViews: AlsoReportedView[]
  /** the suggested "also reported as" facts (`alsoSuggested`), labelled */
  alsoSuggestedViews: SuggestedAlsoView[]
}

export interface AlsoReportedView {
  fact: MappedFact
  conceptLabel: string
  /** members, as labels ("Computer equipments") */
  memberLabels: string[]
  factKey: string | null
  value: string | null
}

export interface SuggestedAlsoView {
  fact: SuggestedAlso
  conceptLabel: string
  memberLabels: string[]
}

export interface TagCellInput {
  cell: CellRef
  concept: string
  /** omitted → inferred from the column header (CY/PY dates), else an error asks for it */
  scope?: Scope
  sign?: 1 | -1
  /** a table fact: its members (the table is found from them unless given) */
  dims?: DimRef[]
  tableId?: string
  preferredLabel?: string | null
}

/** One more fact for a tagged cell's figure (same year as the cell's tag unless given). */
export interface AlsoReportInput {
  mappingId: string
  concept: string
  dims: DimRef[]
  scope?: Scope
  tableId?: string
  preferredLabel?: string | null
}

/** A block row / column of a table mapping (engine TableBlockSpec, sheet-relative). */
export interface TableBlockRowInput {
  r: number
  concept: string
  preferredLabel?: string | null
  scope?: Scope
  members?: DimRef[]
}
export interface TableBlockColumnInput {
  c: number
  members?: DimRef[]
  scope?: Scope
}

/** Map an Excel range to one taxonomy table (ADR-0013). */
export interface TableBlockInput {
  /** the block's range, e.g. "B10:G32" */
  cell: CellRef
  tableId: string
  rows: TableBlockRowInput[]
  cols: TableBlockColumnInput[]
  sign?: 1 | -1
}

/** Persisted in mapping.json `blocks`. */
export interface TableBlock extends TableBlockInput {
  id: string
  origin: MappingOrigin
  confidence: number | null
}

/** One cell of a block, as it would be filed. */
export interface TableBlockCellPlan {
  cell: CellRef
  concept: string
  conceptLabel: string
  scope: Scope | null
  dims: DimRef[]
  preferredLabel: string | null
  /** the amount as it would go into the filing (null when the cell isn't a number) */
  value: string | null
  problems: string[]
}

export interface TableBlockPlan {
  tableId: string
  tableTitle: string
  cells: TableBlockCellPlan[]
  ready: number
  blocked: number
}

export interface TableBlockResult {
  block: TableBlock
  tagged: number
  /** cells not tagged, with why */
  problems: { cell: CellRef; problems: string[] }[]
}

/** A cell's amount as it goes into the filing (Excel float noise rounded to the statement's precision). */
export interface CellAmount {
  /** the number as stored in the workbook, e.g. "5443.466337358575" */
  exact: string
  /** canonical decimal used for the filing, e.g. "5443.47" */
  value: string
  places: number
  /**
   * where `places` came from: the cell's number format, the filing's decimal places, the typed text, or 'actual'
   * (share capital: kept exact to the rupee, whatever the format shows)
   */
  placesFrom: 'format' | 'filing' | 'typed' | 'actual'
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

/** A mandatory amount reported as 0 by "fill empty mandatory amounts". */
export interface ZeroFilled {
  concept: string
  label: string
  scope: Scope
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
  /** the value is an "also reported as" fact of its source cell (the cell's main tag is another fact) */
  also?: boolean
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
  /** dimensional tables in this ELR */
  tableCount: number
  /** the ELR's tables with their values (ADR-0013) */
  tables: FormTable[]
}

/** One column of a table in the Form: a member combination (a "slice") in one year. */
export interface FormTableColumn {
  key: string
  scope: Scope
  dims: DimRef[]
  /** member labels ("Computer equipments · Gross carrying amount"), "Total" without members */
  label: string
}

export interface FormTableRow {
  concept: string
  label: string
  depth: number
  abstract: boolean
  preferredLabel: string | null
  /** column key → cell (none for abstract rows) */
  cells: Record<string, FormCell>
}

export interface FormTable {
  tableId: string
  title: string
  /** the year is closed for this table (not applicable): no columns */
  closed: boolean
  columns: FormTableColumn[]
  rows: FormTableRow[]
}

/** A taxonomy table, for the "Map as table" picker. */
export interface TableInfo {
  id: string
  title: string
  /** the statement / note that shows it */
  elrCode: string
  elrTitle: string
  /** its reportable line items (to offer the tables that report an element) */
  concepts: string[]
}

/** A table's rows and axes, for mapping a block to it. */
export interface TableStructure extends TableInfo {
  lineItems: { concept: string; label: string; preferredLabel: string | null; depth: number; abstract: boolean; periodType: string | null }[]
  axes: { axis: string; label: string; typed: boolean; default: string | null; members: { member: string; label: string; depth: number; usable: boolean }[] }[]
}

/** A table amount reported as 0 by "fill table zeros". */
export interface TableZeroFilled {
  tableId: string
  concept: string
  label: string
  scope: Scope
  memberLabels: string[]
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
