/**
 * @xap/engine: deterministic XBRL core.
 *
 * Phase 1 exposes only the package skeleton and shared types. Phase 2 ports
 * lagacy_js modules here (see docs/04-xbrl-engine.md for the porting map).
 */
export const ENGINE_VERSION = '0.1.0'

export type TaxonomyId = 'ci-2016' | 'ind-as-2017' | 'costing-2019'

export type Severity = 'ERROR' | 'WARNING' | 'INFO'

export type PeriodKey = 'cy' | 'py'

export interface DimensionRef {
  axis: string
  member?: string
  typed?: string
}

export interface FactRef {
  concept: string
  period: PeriodKey
  dims: DimensionRef[]
}

export interface CellRef {
  workbook?: string
  sheet: string
  ref: string
}

export interface IssueLocation {
  elr?: string
  table?: string
  fact?: FactRef
  cell?: CellRef
}

export interface Issue {
  code: string
  severity: Severity
  message: string
  location?: IssueLocation
}

export const SUPPORTED_TAXONOMIES: ReadonlyArray<{ id: TaxonomyId; label: string; v1: boolean }> = [
  { id: 'ci-2016', label: 'C&I 2016 (AOC-4 XBRL, non-Ind AS)', v1: true },
  { id: 'ind-as-2017', label: 'Ind AS 2017', v1: false },
  { id: 'costing-2019', label: 'Costing 2019 (CRA-4)', v1: false },
]

/** CIN format: e.g. U12345MH2010PTC123456 (21 chars). Ported from lagacy_js/expr.js FORMATS. */
export const CIN_PATTERN = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/

export function isValidCin(cin: string): boolean {
  return CIN_PATTERN.test(cin.trim().toUpperCase())
}
