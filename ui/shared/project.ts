/** Project-level types shared by main, preload and renderer. See docs/03-project-file-axbrl.md. */
import type { ReportType, RoundingLevel } from '@xap/engine/basics'

export type { ReportType, RoundingLevel }

export interface Period {
  start: string
  end: string
}

export interface NewFilingInput {
  companyName: string
  cin: string
  reportType: ReportType
  cy: Period
  /** null when this is the company's first financial year */
  py: Period | null
  level: RoundingLevel
  /** "Decimal places as presented" (0 … maxDisplayPlaces(level)); omitted → defaultDisplayPlaces(level) */
  displayPlaces?: number
}

export interface ProjectSummary {
  id: string
  /** null until first saved */
  path: string | null
  fileName: string | null
  dirty: boolean
  taxonomy: 'ci-2016'
  company: { name: string; cin: string }
  reportType: ReportType
  cy: Period
  py: Period | null
  firstFinancialYear: boolean
  level: RoundingLevel
  displayPlaces: number
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
