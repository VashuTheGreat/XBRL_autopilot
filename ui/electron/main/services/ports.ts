/**
 * Ports: the small interfaces the main-process services depend on (dependency inversion).
 * Production adapters live in ../infra; tests use in-memory fakes.
 */
import type { Authority, Session } from '@xap/engine'
import type { TaxonomyId } from '@xap/engine/basics'
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
  request<T>(method: HttpMethod, path: string, body?: unknown): Promise<SidecarResponse<T>>
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

/** The business-rule half, compiled by engine/compiler; null when the taxonomy has no compiled rules yet. */
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
}

export interface ProjectAccess {
  /** throws NoProjectError when nothing is open */
  project(): ProjectHandle
}

export interface Clock {
  now(): Date
}

export const systemClock: Clock = { now: () => new Date() }
