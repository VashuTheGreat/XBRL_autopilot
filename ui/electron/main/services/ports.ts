/**
 * Ports: the small interfaces the main-process services depend on (dependency inversion).
 * Production adapters live in ../infra; tests use in-memory fakes.
 */
import type { Authority, Session } from '@xap/engine'
import type { TaxonomyId } from '@xap/engine/basics'
import type { AiPatch } from '@shared/ai'
import type { HttpMethod, SidecarResponse } from '@shared/ipc'
import type { ElrInfo, RecentProject } from '@shared/project'
import type { AxbrlContent, AxbrlManifest } from '../project/axbrl'

export interface LoadedAuthority {
  taxonomyId: TaxonomyId
  authority: Authority
  hash: string | null
}

/** A concept as the knowledge-base search returns it (FastAPI ?summary=true). */
export interface CatalogConcept {
  qname: string
  label: string
  type: string | null
  periodType: 'instant' | 'duration' | null
  balance: 'debit' | 'credit' | null
  abstract: boolean
  reportable: boolean
  mandatory: boolean
  elrCodes: string[]
}

/** One node of an ELR presentation tree (FastAPI /elrs/{code}/tree). */
export interface ElrTreeNode {
  qname: string
  label: string
  abstract: boolean
  type: string | null
  periodType: 'instant' | 'duration' | null
  balance: 'debit' | 'credit' | null
  children: ElrTreeNode[]
}

export interface ElrTree {
  uri: string
  code: string
  title: string
  group: ElrInfo['group']
  tree: ElrTreeNode[]
}

/** Taxonomy browsing data (knowledge base via the FastAPI routes). */
export interface TaxonomyCatalog {
  elrs(taxonomy: TaxonomyId): Promise<ElrInfo[]>
  elrTree(taxonomy: TaxonomyId, code: string): Promise<ElrTree>
  searchConcepts(taxonomy: TaxonomyId, query: string, limit: number): Promise<CatalogConcept[]>
}

/** The part of the sidecar manager that HTTP adapters need. */
export interface SidecarClient {
  whenReady(timeoutMs: number): Promise<void>
  request<T>(method: HttpMethod, path: string, body?: unknown, timeoutMs?: number): Promise<SidecarResponse<T>>
}

/** Supplies the engine authority of a taxonomy (loaded once per taxonomy, cached by the implementation). */
export interface AuthorityProvider {
  load(taxonomy: TaxonomyId): Promise<LoadedAuthority>
}

/** Raw authority JSON as the engine's assembleAuthority takes it (ADR-0010). */
export type AuthorityJson = Record<string, unknown> & { meta: Record<string, unknown> }

/** The taxonomy half: concepts, networks, dimensional model (sidecar route /taxonomies/{id}/authority). */
export interface TaxonomyAuthoritySource {
  taxonomyAuthority(taxonomy: TaxonomyId): Promise<AuthorityJson>
}

/** The business-rule half (sidecar route /taxonomies/{id}/engine-rules, ADR-0011); null when the taxonomy has no rules. */
export interface RuleBundleSource {
  rules(taxonomy: TaxonomyId): Promise<AuthorityJson | null>
}

export interface RecentProjectsRepository {
  touch(entry: Omit<RecentProject, 'exists'>): void
  list(limit?: number): Omit<RecentProject, 'exists'>[]
  remove(path: string): void
}

/** Plain key/value settings (non-secret). */
export interface KeyValueRepository {
  get(key: string): string | null
  set(key: string, value: string): void
}

/** One secret (the Groq API key), encrypted at rest by the OS. Async: OS key stores may prompt or block. */
export interface SecretStore {
  isAvailable(): Promise<boolean>
  get(): Promise<string | null>
  set(value: string): Promise<void>
  clear(): Promise<void>
}

export interface AutosaveEntry {
  id: string
  manifest: AxbrlManifest
  originalPath: string | null
  savedAt: string
}

/** Crash-recovery copies of unsaved projects. */
export interface AutosaveStore {
  write(id: string, content: AxbrlContent, originalPath: string | null): Promise<void>
  list(): Promise<AutosaveEntry[]>
  read(id: string): Promise<{ content: AxbrlContent; originalPath: string | null }>
  remove(id: string): Promise<void>
}

/** Periods of the open filing, in the shape the mapping helpers use. */
export interface FilingPeriods {
  cy: { start: string; end: string }
  py: { start: string; end: string } | null
}

/** Narrow access to the open filing for services other than ProjectService (interface segregation). */
export interface ProjectHandle {
  readonly id: string
  readonly session: Session
  readonly content: AxbrlContent
  readonly authority: LoadedAuthority
  periods(): FilingPeriods
  /** call after changing sources/mapping (marks dirty) or facts (refreshes views) */
  touch(): void
  /** runs `fn` with change notifications held back: one notification at the end, however many touches (bulk edits) */
  batch<T>(fn: () => Promise<T>): Promise<T>
}

export interface ProjectAccess {
  /** throws NoProjectError when nothing is open */
  project(): ProjectHandle
}

// ------------------------------------------------------------------ auto-tagging (docs/06-ai-auto-tagging.md)

/** A label the user tagged before, sent with every suggest request (the sidecar is stateless). */
export interface MappingMemoryItem {
  label: string
  concept: string
  approvals: number
}

/** The per-installation learning loop (app.db `mapping_memory`). Private: never leaves the machine except to the local sidecar. */
export interface MappingMemoryRepository {
  recall(taxonomy: TaxonomyId): MappingMemoryItem[]
  remember(taxonomy: TaxonomyId, label: string, concept: string): void
}

export interface SuggestRequest {
  taxonomy: TaxonomyId
  sheets: { name: string; cells: { r: number; c: number; v: string | number | boolean }[] }[]
  periods: { cyEnd: string; pyEnd: string | null }
  level: string
  memory: MappingMemoryItem[]
  useLlm: boolean
}

/** One suggested fact for one value cell of the sheet. */
export interface Suggestion {
  cell: { sheet: string; ref: string }
  label: string
  concept: string
  conceptLabel: string
  scope: 'CY' | 'PY'
  sign: 1 | -1
  confidence: number
  origin: 'memory' | 'exact' | 'lexical' | 'ai'
  rationale: string
  needsReview: boolean
  alternatives: { concept: string; label: string; score: number }[]
  /** "also report as" the same figure under a table's members (e.g. the one class of shares) */
  also?: SuggestedAlsoItem[]
}

export interface SuggestedAlsoItem {
  concept: string
  tableId: string
  preferredLabel: string | null
  dims: { axis: string; member?: string; typed?: string }[]
  confidence: number
  reason?: string
}

/** A block of a note sheet mapped to one taxonomy table (src/services/tagging/tables.py, ADR-0013). */
export interface SuggestedBlock {
  sheet: string
  /** "B11:G33" */
  range: string
  tableId: string
  tableTitle: string
  confidence: number
  rows: { r: number; concept: string; preferredLabel?: string | null; scope?: 'CY' | 'PY'; members?: { axis: string; member?: string; typed?: string }[] }[]
  cols: { c: number; members?: { axis: string; member?: string; typed?: string }[]; scope?: 'CY' | 'PY' }[]
  /** the cells the tagger planned (with a member); the app re-plans with the engine */
  cells: { ref: string }[]
}

export interface SuggestResponse {
  layout: { sheet: string; kind: string; rows: number; note: string | null }[]
  suggestions: Suggestion[]
  /** table suggestions (absent from older sidecars) */
  blocks?: SuggestedBlock[]
  llmUsed: boolean
}

/** Proposes tags for a workbook (the sidecar's POST /api/v1/mapping/suggest). Never writes facts. */
export interface MappingSuggester {
  suggest(req: SuggestRequest): Promise<SuggestResponse>
}

export interface Clock {
  now(): Date
}

export const systemClock: Clock = { now: () => new Date() }

// ------------------------------------------------------------------ AI fix agent (docs/07, ADR-0012)

/** The context bundle of one problem, as POST /api/v1/fix/propose takes it (src/services/fix_agent/bundle.py). */
export interface FixBundle {
  taxonomy: TaxonomyId
  problem: {
    id: string
    severity: 'error' | 'warning' | 'info'
    family: string
    code: string
    ruleId: string | null
    message: string
    elrCode: string | null
    elrTitle: string | null
    concept: string | null
    scope: string | null
    factKey: string | null
    cell: { workbook: string; sheet: string; ref: string } | null
    rule: { id: string; text: string; implementation: string | null; ast: unknown } | null
    mcaText: string | null
    explanation: { title: string; meaning: string; cause: string; fix: string } | null
  }
  facts: FixBundleFact[]
  sources: FixBundleSource[]
  meta: { reportType: string | null; cyStart: string; cyEnd: string; pyStart: string | null; pyEnd: string | null; level: string; firstFinancialYear: boolean }
  options: { maxSteps: number; maxTokens: number }
}

export interface FixBundleFact {
  key: string
  concept: string
  label: string
  dataType: string
  scope: 'CY' | 'PY' | 'PYO' | 'OTHER' | null
  period: string
  dims: { axis: string; member: string }[]
  value: string | null
  display: string | null
  nil: boolean
  decimals: string | null
  origin: string | null
  cell: { workbook: string; sheet: string; ref: string } | null
  elrs: string[]
}

export interface FixBundleSource {
  cell: { workbook: string; sheet: string; ref: string }
  label: string | null
  value: string | number | boolean | null
  neighbours: { ref: string; value: string | number | boolean | null; column: 'CY' | 'PY' | null }[]
}

export interface FixProposal {
  summary: string
  patches: AiPatch[]
  dropped: { patch: unknown; reason: string }[]
  resolves: string[]
  needsHuman: boolean
  steps: number
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  toolCalls: { name: string; arguments: unknown }[]
  stop: string
  model: string | null
}

/** Proposes patches for one problem (the sidecar's POST /api/v1/fix/propose). Never writes anything. */
export interface FixProposer {
  propose(bundle: FixBundle): Promise<FixProposal>
}

/** What decides whether AI may run right now (Settings consent, Groq key, sidecar state). */
export interface AiAvailability {
  state(): { consent: boolean; sidecar: 'ready' | 'starting' | 'down'; keyConfigured: boolean; model: string | null }
}

/** Refuses AI for projects built from the repository's client fixtures (dev only; a no-op in the packaged app). */
export interface FixtureGuard {
  /** the fixture's file name when the project's workbook or imported XML is one of them, else null */
  match(content: AxbrlContent): string | null
}
