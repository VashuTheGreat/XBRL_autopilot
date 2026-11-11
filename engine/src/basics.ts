/**
 * @xap/engine/basics: dependency-free types and helpers that are safe to import anywhere
 * (including the renderer bundle). The full engine is in ./index.ts.
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

export const SUPPORTED_TAXONOMIES: ReadonlyArray<{ id: TaxonomyId; label: string; hint: string; v1: boolean }> = [
  { id: 'ci-2016', label: 'C&I 2016', hint: 'AOC-4 XBRL, companies not on Ind AS (Schedule III Division I)', v1: true },
  { id: 'ind-as-2017', label: 'Ind AS 2017', hint: 'AOC-4 XBRL, companies on Ind AS (Schedule III Division II)', v1: true },
  { id: 'costing-2019', label: 'Costing 2019', hint: 'CRA-4', v1: false },
]

/** The taxonomies a new filing can use in this version (AOC-4 XBRL). */
export const FILING_TAXONOMIES = SUPPORTED_TAXONOMIES.filter((t) => t.v1)
export const DEFAULT_TAXONOMY: TaxonomyId = 'ci-2016'

export function isFilingTaxonomy(id: unknown): id is TaxonomyId {
  return FILING_TAXONOMIES.some((t) => t.id === id)
}

export function taxonomyLabel(id: TaxonomyId): string {
  return SUPPORTED_TAXONOMIES.find((t) => t.id === id)?.label ?? id
}

/** CIN format: e.g. U12345MH2010PTC123456 (21 chars). Ported from lagacy_js/expr.js FORMATS. */
export const CIN_PATTERN = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/

export function isValidCin(cin: string): boolean {
  return CIN_PATTERN.test(cin.trim().toUpperCase())
}

export type ReportType = 'Standalone' | 'Consolidated'

/** Levels of rounding accepted by the engine (scaling.js SCALE_POWERS). */
export const ROUNDING_LEVELS = ['Actual', 'Thousands', 'Lakhs', 'Millions', 'Crores', 'Billions'] as const
export type RoundingLevel = (typeof ROUNDING_LEVELS)[number]

/**
 * The finest decimal places an amount can have at a level of rounding: places that reach paise (Actual 2, Lakhs 7).
 * The engine's `displayPlaces`, and the upper bound of "decimal places as presented" (`statementPlaces`). Mirrors scaling.js SCALE_POWERS for the renderer, which doesn't load the engine core
 * (a test keeps the two in step).
 */
export function maxDisplayPlaces(level: RoundingLevel): number {
  const power: Record<RoundingLevel, number> = { Actual: 0, Thousands: 3, Lakhs: 5, Millions: 6, Crores: 7, Billions: 9 }
  return power[level] + 2
}

/** The usual places for a level: whole rupees for Actual, two places for scaled statements (₹ 5,443.47 lakhs). */
export function defaultStatementPlaces(level: RoundingLevel): number {
  return level === 'Actual' ? 0 : 2
}

/** yyyy-mm-dd → Date (UTC) or null. */
function utc(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const d = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : d
}

/** The previous year implied by a current year: same length, ending the day before CY starts. */
export function previousYearOf(cy: { start: string; end: string }): { start: string; end: string } | null {
  const s = utc(cy.start)
  const e = utc(cy.end)
  if (!s || !e || s > e) return null
  const pyEnd = new Date(s.getTime() - 86_400_000)
  const pyStart = new Date(Date.UTC(s.getUTCFullYear() - 1, s.getUTCMonth(), s.getUTCDate()))
  return { start: pyStart.toISOString().slice(0, 10), end: pyEnd.toISOString().slice(0, 10) }
}

/** "FY 2025-26" for a year ending 2026-03-31. */
export function fyLabel(cy: { start: string; end: string }): string {
  const s = cy.start.slice(0, 4)
  const e = cy.end.slice(0, 4)
  return s === e ? `FY ${s}` : `FY ${s}-${e.slice(2)}`
}

/** Mirrors engine periods.validatePeriods (CY/PY ISO dates, order, no overlap). */
export function validateFilingPeriods(
  cy: { start: string; end: string },
  py: { start: string; end: string } | null,
): string[] {
  const errs: string[] = []
  const check = (k: string, p: { start: string; end: string }) => {
    const s = utc(p.start)
    const e = utc(p.end)
    if (!s || !e) errs.push(`${k} dates must be valid dates (yyyy-mm-dd)`)
    else if (s > e) errs.push(`${k} start is after its end`)
  }
  check('Current year', cy)
  if (py) {
    check('Previous year', py)
    if (!errs.length && py.end >= cy.start) errs.push('Previous year must end before the current year starts')
  }
  return errs
}

/**
 * The financial year being filed on `today`: the last April–March year that has ended.
 * AOC-4 for FY 2025-26 is filed after 31 Mar 2026, so on 2026-11-10 this returns 2025-04-01 … 2026-03-31.
 */
export function defaultReportingYear(today: Date): { start: string; end: string } {
  const y = today.getFullYear()
  const startYear = today.getMonth() >= 3 ? y - 1 : y - 2 // month 3 = April
  return { start: `${startYear}-04-01`, end: `${startYear + 1}-03-31` }
}

/**
 * Indian digit grouping for display: "60000000" → "6,00,00,000", "-343854.5" → "-3,43,854.5".
 * Text that isn't a plain decimal number is returned unchanged.
 */
export function formatIndian(value: string): string {
  const m = /^(-?)(\d+)(\.\d+)?$/.exec(value.trim())
  if (!m) return value
  const [, sign, int, frac = ''] = m
  const last3 = int!.slice(-3)
  const rest = int!.slice(0, -3)
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3
  return `${sign}${grouped}${frac}`
}

const MONTH = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?`
/** Dates written in text ("March 31, 2025", "31st March, 2025", "31.03.2025", "2025-03-31", "FY 2025-26"): not figures. */
const DATES_IN_TEXT = new RegExp(
  [
    String.raw`\b\d{4}-\d{2}-\d{2}\b`,
    String.raw`\b${MONTH}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{2,4}\b`,
    String.raw`\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?${MONTH},?\s+\d{2,4}\b`,
    String.raw`\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b`,
    String.raw`\b(?:fy\s*)?\d{4}\s*[-–/]\s*\d{2,4}\b`,
  ].join('|'),
  'gi',
)
const NUMBER_IN_TEXT = /\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?/g

/**
 * The figures a text cell states, in order, with its dates removed and grouping commas dropped (ADR-0013: a share
 * count written in a note's text). "10,00,000 (March 31, 2025 : 10,00,000) Equity Shares of Rs. 10/- each" →
 * ["1000000", "1000000", "10"]. The sidecar's twin is src/services/tagging/text.py `numbers_in_text`; both are checked
 * against tests/fixtures/numbers_in_text.json.
 */
export function numbersInText(text: string): string[] {
  const plain = text.replace(DATES_IN_TEXT, ' ')
  return [...plain.matchAll(NUMBER_IN_TEXT)].map((m) => m[0].replace(/,/g, ''))
}
