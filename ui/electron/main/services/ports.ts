/**
 * Ports: the small interfaces the main-process services depend on (dependency inversion).
 * Production adapters live in ../infra; tests use in-memory fakes.
 */
import type { Authority, Session } from '@xap/engine'
import type { ElrInfo, RecentProject } from '@shared/project'
import type { AxbrlContent, AxbrlManifest } from '../project/axbrl'

export interface LoadedAuthority {
  taxonomyId: 'ci-2016'
  authority: Authority
  hash: string | null
  elrs: ElrInfo[]
}

/** Supplies the compiled taxonomy authority (loaded once, cached by the implementation). */
export interface AuthorityProvider {
  load(): Promise<LoadedAuthority>
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
