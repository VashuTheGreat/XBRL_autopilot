/** Project-level types shared by main, preload and renderer. See docs/03-project-file-axbrl.md. */
import type { ReportType, RoundingLevel, TaxonomyId } from '@xap/engine/basics'

export type { ReportType, RoundingLevel, TaxonomyId }

export interface Period {
  start: string
  end: string
}

export interface NewFilingInput {
  /** C&I 2016 or Ind AS 2017; omitted → C&I 2016 */
  taxonomy?: TaxonomyId
  companyName: string
  cin: string
  reportType: ReportType
  cy: Period
  /** null when this is the company's first financial year */
  py: Period | null
  level: RoundingLevel
  /**
   * "Decimal places as presented": the statement figures' places (engine meta.statementPlaces), 0 … maxDisplayPlaces(level);
   * omitted → defaultStatementPlaces(level). Amounts finer than this (share capital to the rupee) are still kept exactly.
   */
  statementPlaces?: number
}

/** How an existing XBRL instance becomes a filing (Phase 7). */
export type InstanceImportMode =
  /** open that year's filing: current- and previous-year facts as filed */
  | 'both'
  /** start the following year's filing: the instance's current year becomes the previous year */
  | 'next'

/** What the user sees after importing an XBRL instance (also saved in the project as import/<name>.report.json). */
export interface ImportReportView {
  fileName: string
  mode: InstanceImportMode
  taxonomy: TaxonomyId
  schemaRef: string
  periods: { cy: Period; py: Period | null }
  counts: { sourceFacts: number; imported: number; unresolved: number; footnotes: number; skippedPrevious: number }
  warnings: string[]
  /** facts that could not be imported, with the reason (first 200) */
  unresolved: { concept: string; context: string | null; reason: string }[]
  /** 'both' only: the filing regenerated and compared with the source, fact by fact (meaning, not text) */
  roundTrip: {
    identical: boolean
    sourceFacts: number
    equal: number
    missing: string[]
    extra: string[]
    changed: { key: string; source: string[]; regenerated: string[] }[]
  } | null
  /** vendor choices that don't change the facts: theirs vs ours */
  conventions: { source: InstanceConventionsView; ours: InstanceConventionsView }
}

export interface InstanceConventionsView {
  generator: string | null
  contexts: number
  duplicateContexts: number
  contextIdStyle: 'descriptive' | 'short'
  longestContextId: number
  facts: number
  factsWithId: number
  units: string[]
  footnotes: number
  decimals: Record<string, number>
}

export interface ProjectSummary {
  id: string
  /** null until first saved */
  path: string | null
  fileName: string | null
  dirty: boolean
  taxonomy: TaxonomyId
  company: { name: string; cin: string }
  reportType: ReportType
  cy: Period
  py: Period | null
  firstFinancialYear: boolean
  level: RoundingLevel
  statementPlaces: number
  fyLabel: string
  factCount: number
  /** bumps on every change to facts, mapping or sources: views refetch when it changes */
  revision: number
  sources: string[]
  createdAt: string
  updatedAt: string
  /** set when the file was written by a newer app version (opened read-only) */
  readOnlyReason: string | null
}

export interface RecentProject {
  path: string
  company: string
  cin: string
  fy: string
  openedAt: string
  exists: boolean
}

export interface RecoveryItem {
  id: string
  company: string
  fy: string
  savedAt: string
  originalPath: string | null
}

export interface ElrInfo {
  uri: string
  code: string
  title: string
  group: 'Statements' | 'Notes' | 'Disclosures'
}

export interface AppSettings {
  groqModel: string
  mcaToolPath: string
  autosaveSeconds: number
  aiConsent: boolean
}

export interface SettingsState extends AppSettings {
  hasGroqKey: boolean
  /** true when the key comes from the dev .env (no key stored in Settings) */
  groqKeyFromEnv: boolean
  canEncrypt: boolean
}
