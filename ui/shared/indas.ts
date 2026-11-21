/**
 * Contracts for Vashu's Ind AS pipeline (docs/17): Excel → canonical sheets → tags → masters → XML,
 * driven through the sidecar's /api/v1/indas/* routes.
 */

/** One canonical row as the sidecar returns it (column → value; blank cells are null). */
export type CanonicalRow = Record<string, string | number | boolean | null>

/** The sheet names produced by /indas/transform (and present in the standard template). */
export const CANONICAL_SHEETS = [
  'CANONICAL_BS',
  'CANONICAL_PL',
  'CANONICAL_CF',
  'CANONICAL_SOCIE',
  'CANONICAL_PPE_SCHEDULE',
  'CANONICAL_FINANCIAL_NOTES',
] as const

/** The statements /indas/generateXML accepts today, with the canonical sheet each comes from. */
export const TAGGED_STATEMENTS = [
  { key: 'balanceSheet', sheet: 'CANONICAL_BS', title: 'Balance Sheet' },
  { key: 'profitLoss', sheet: 'CANONICAL_PL', title: 'Profit and Loss' },
] as const
export type StatementKey = (typeof TAGGED_STATEMENTS)[number]['key']

export interface TransformResult {
  /** the uploaded workbook's file name */
  fileName: string
  /** 'standard_template' = read as-is (input path 1); 'heuristic' = converted automatically (path 2) */
  source: string
  sheets: Record<string, CanonicalRow[]>
  /** the transformation's own report (sheet sizes, checks) */
  summary: Record<string, unknown>
}

export interface ConceptSuggestion {
  qname: string
  label: string
  score: number
  type: string | null
  periodType: string | null
  balance: string | null
}

export interface MasterField {
  qname: string
  label: string
  /** XBRL item type, e.g. stringItemType, dateItemType, booleanItemType, CINNumber */
  type: string
}

export interface MasterFields {
  company: MasterField[]
  auditor: MasterField[]
}

export interface Signatory {
  din: string
  name: string
  designation: string
  signingDate?: string
}

/** One tagged statement line (amounts exactly as the canonical sheet gave them). */
export interface StatementLine {
  concept: string
  cy: number | null
  py: number | null
}

export interface GenerateXmlInput {
  meta: {
    nature: 'Standalone' | 'Consolidated'
    /** YYYY-MM-DD */
    startDate: string
    endDate: string
  }
  master: {
    company: Record<string, string>
    auditor: Record<string, string>
    signatories: Signatory[]
  }
  statements: Record<StatementKey, StatementLine[]>
  /** used for the output file name */
  companyName: string
}

export interface GenerateXmlProblem {
  type: string | null
  message: string
}

export type GenerateXmlResult =
  | { ok: true; path: string; fileName: string; sizeKb: number }
  | { ok: false; errors: GenerateXmlProblem[] }
