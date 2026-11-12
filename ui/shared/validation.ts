/** Validation read-model shared by main and renderer (Phase 9, docs/05-validation.md). */
import type { CellRef } from './workbook'

export type ProblemSeverity = 'error' | 'warning' | 'info'
/** engine = the app's own checks (gate, rules, calculation, dimensions); mca = imported from the MCA Validation Tool */
export type ProblemSource = 'engine' | 'mca'
export type ProblemFamily = 'document' | 'fact' | 'dimension' | 'calculation' | 'rule' | 'review' | 'coverage' | 'mca'

/** Where a problem is in the editor: the XBRL Form (statement, row, period) and/or a table. */
export interface ProblemLocation {
  kind: 'cell' | 'table' | 'general' | 'pyo' | 'concept'
  elrUri: string | null
  elrCode: string | null
  /** statement / note title, for grouping */
  elrTitle: string | null
  tableId: string | null
  concept: string | null
  scope: string | null
  /** the fact key (engine), when the problem is about a reported value */
  factKey: string | null
}

export interface Problem {
  /** stable within one validation run; used to apply a quick fix */
  id: string
  severity: ProblemSeverity
  source: ProblemSource
  family: ProblemFamily
  code: string
  ruleId: string | null
  message: string
  location: ProblemLocation | null
  /** the Excel cell the value came from (approved mappings only) */
  cell: CellRef | null
  /** a deterministic quick fix exists (engine fixes.js) */
  fix: { label: string } | null
  /** MCA tool errors: plain-language explanation */
  explanation?: { title: string; meaning: string; cause: string; fix: string }
}

export interface RuleCoverageSummary {
  executable: number
  reviewOnly: number
  unimplemented: number
  notApplicable: number
  /** EXECUTABLE ÷ (all − NOT_APPLICABLE), ADR-0011 */
  executableShare: number | null
}

export interface ValidationView {
  /** increases with every run; the renderer ignores stale views */
  revision: number
  /** ISO time of the run, null before the first run */
  at: string | null
  durationMs: number
  summary: { errors: number; warnings: number; info: number }
  problems: Problem[]
  coverage: RuleCoverageSummary
  /** the MCA error list imported last, if any */
  mca: { file: string; count: number } | null
}

export interface McaLaunchResult {
  /** the XML written for the tool (also kept in the project's output/ folder) */
  xmlPath: string
  toolPath: string
  /** false: written in spite of internal errors (marked "NOT VALIDATED" in the XML) */
  validated: boolean
}
