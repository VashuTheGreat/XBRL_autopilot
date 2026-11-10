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
