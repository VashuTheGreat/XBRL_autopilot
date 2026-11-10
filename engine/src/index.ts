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

// ---------------------------------------------------------------------------------------------
// Core engine (behaviour-preserving port of lagacy_js; see docs/04-xbrl-engine.md).
// Modules in ./core are JS for now and are converted to TS one at a time; the public surface
// below is the stable API the app uses.
// ---------------------------------------------------------------------------------------------
export { Authority } from './core/authority.js'
export { Session, DimensionError, CalculatedCellError, PyLockedError } from './core/session.js'
export { Filing, FactValueError, factKey, dimKey, normDims, defaultMeta } from './core/model.js'
export { generateInstance, buildContexts } from './core/generator.js'
export { importInstance, CashFlowChoiceError, detectCashFlow } from './core/importer.js'
export { Gate, GateError, exportXml, htmlGuidelineIssues } from './core/gate.js'
export { RuleEngine } from './core/rules.js'
export { runCalculations, calculationNetworks } from './core/calculation.js'
export { explainMcaErrors } from './core/mca-errors.js'
export { fixFor } from './core/fixes.js'
export { toMca, fromMca, tidy as tidyRichText, plainText } from './core/richtext.js'
export { buildPreviewHtml, groupIN, formatValue } from './core/pdf-preview.js'
export { buildElrView, buildTableView, tableSlices } from './core/views.js'
export { SCALE_POWERS, toCanonical, toDisplay } from './core/scaling.js'
export { compareFilings } from './core/compare.js'
export { carryForwardPlan, carryForward } from './core/carry-forward.js'
export { buildExample, completeMandatory } from './core/example.js'
export * as decimal from './core/decimal.js'
