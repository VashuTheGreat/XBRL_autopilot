/**
 * ProjectService: lifecycle of the open filing (new / open / save / save as / close / autosave / recovery).
 * Electron-free: everything external comes in through ports, so it is unit-tested with fakes.
 * docs/03-project-file-axbrl.md
 */
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { Filing, Session } from '@xap/engine'
import { fyLabel, isValidCin, ROUNDING_LEVELS, validateFilingPeriods } from '@xap/engine/basics'
import type { ElrInfo, NewFilingInput, ProjectSummary, RecentProject, RecoveryItem } from '@shared/project'
import {
  AXBRL_FORMAT,
  AXBRL_FORMAT_VERSION,
  emptyContent,
  readAxbrl,
  writeAxbrl,
  type AxbrlContent,
  type AxbrlManifest,
} from '../project/axbrl'
import { NoProjectError, NoSavePathError, ReadOnlyProjectError, ValidationError } from './errors'
import type { AuthorityProvider, AutosaveStore, Clock, LoadedAuthority, ProjectAccess, ProjectHandle, RecentProjectsRepository } from './ports'
import { systemClock } from './ports'

export interface ProjectServiceDeps {
  authority: AuthorityProvider
  recents: RecentProjectsRepository
  autosave: AutosaveStore
  appVersion: string
  clock?: Clock
  newId?: () => string
  fileExists?: (path: string) => boolean
}

interface OpenProject {
  id: string
  path: string | null
  session: Session
  /** everything in the .axbrl except filing.json (which comes from the live session) */
  content: AxbrlContent
  savedRevision: number
  /** changes outside the engine filing (mapping, sources, …) since the last save */
  extraDirty: boolean
  /** changes to non-engine content (mapping, sources) since open */
  contentRevision: number
  readOnlyReason: string | null
  loaded: LoadedAuthority
}

export type ProjectEvents = { changed: [ProjectSummary | null] }

const BLANK_PERIOD = { start: '', end: '' }

export class ProjectService extends EventEmitter<ProjectEvents> implements ProjectAccess {
  private current: OpenProject | null = null
  private readonly clock: Clock
  private readonly newId: () => string
  private readonly fileExists: (path: string) => boolean

  constructor(private readonly deps: ProjectServiceDeps) {
    super()
    this.clock = deps.clock ?? systemClock
    this.newId = deps.newId ?? randomUUID
    this.fileExists = deps.fileExists ?? existsSync
  }

  // ---------------------------------------------------------------- queries
  summary(): ProjectSummary | null {
    const p = this.current
    if (!p) return null
    const m = p.session.filing.meta as {
      name: string
      cin: string
      reportType: ProjectSummary['reportType']
      periods: { cy: { start: string; end: string }; py: { start: string; end: string } }
      firstFinancialYear: boolean
      level: ProjectSummary['level']
    }
    return {
      id: p.id,
      path: p.path,
      fileName: p.path ? basename(p.path) : null,
      dirty: this.isDirty(),
      taxonomy: 'ci-2016',
      company: { name: m.name, cin: m.cin },
      reportType: m.reportType,
      cy: { ...m.periods.cy },
      py: m.firstFinancialYear ? null : { ...m.periods.py },
      firstFinancialYear: m.firstFinancialYear,
      level: m.level,
      fyLabel: fyLabel(m.periods.cy),
      factCount: p.session.filing.facts.size,
      revision: p.session.filing.revision + p.contentRevision * 1_000_000,
      sources: Object.keys(p.content.sources),
      createdAt: p.content.manifest.createdAt,
      updatedAt: p.content.manifest.updatedAt,
      readOnlyReason: p.readOnlyReason,
    }
  }

  isDirty(): boolean {
    const p = this.current
    return !!p && (p.extraDirty || p.session.filing.revision !== p.savedRevision)
  }

  hasProject(): boolean {
    return this.current !== null
  }

  /** ProjectAccess: a narrow handle on the open filing for the editor services. */
  project(): ProjectHandle {
    const p = this.require()
    return {
      id: p.id,
      session: p.session,
      content: p.content,
      authority: p.loaded,
      periods: () => {
        const m = p.session.filing.meta as { firstFinancialYear: boolean; periods: { cy: { start: string; end: string }; py: { start: string; end: string } } }
        return { cy: { ...m.periods.cy }, py: m.firstFinancialYear ? null : { ...m.periods.py } }
      },
      touch: () => {
        if (this.current !== p) return // the project was closed/replaced meanwhile
        p.extraDirty = true
        p.contentRevision++
        this.emitChanged()
      },
    }
  }

  /** The live engine session, for engine-level features (Phase 4+). */
  session(): Session {
    return this.require().session
  }

  async elrs(): Promise<ElrInfo[]> {
    return (await this.deps.authority.load()).elrs
  }

  recentProjects(): RecentProject[] {
    return this.deps.recents.list().map((r) => ({ ...r, exists: this.fileExists(r.path) }))
  }

  forgetRecent(path: string): void {
    this.deps.recents.remove(path)
  }

  // ---------------------------------------------------------------- commands
  async newFiling(input: NewFilingInput): Promise<ProjectSummary> {
    const problems = validateNewFiling(input)
    if (problems.length) throw new ValidationError(problems)
    const loaded = await this.deps.authority.load()
    const session = new Session(loaded.authority)
    const first = input.py === null
    session.setMeta({
      name: input.companyName.trim(),
      cin: input.cin.trim().toUpperCase(),
      reportType: input.reportType,
      firstFinancialYear: first,
      level: input.level,
      periods: { cy: { ...input.cy }, py: first ? { ...BLANK_PERIOD } : { ...input.py! } },
    })
    const nameOfCompany = loaded.authority.qnameOfLocal('NameOfCompany')
    if (nameOfCompany) session.setValue(nameOfCompany, 'CY', input.companyName.trim())

    const now = this.clock.now().toISOString()
    const id = this.newId()
    const manifest: AxbrlManifest = {
      format: AXBRL_FORMAT,
      formatVersion: AXBRL_FORMAT_VERSION,
      appVersion: this.deps.appVersion,
      projectId: id,
      createdAt: now,
      updatedAt: now,
      taxonomy: { id: loaded.taxonomyId, authorityHash: loaded.hash },
      company: { name: '', cin: '' },
      filing: { reportType: input.reportType, cy: input.cy, py: input.py, firstFinancialYear: first, roundingLevel: input.level },
    }
    // A new filing starts dirty: it exists only in memory until saved (revision -1 never matches).
    await this.replaceCurrent({
      id, path: null, session, content: emptyContent(manifest, null), savedRevision: -1, extraDirty: false, contentRevision: 0, readOnlyReason: null, loaded,
    })
    return this.summary()!
  }

  async open(path: string): Promise<ProjectSummary> {
    const { content, readOnlyReason } = await readAxbrl(path)
    const project = await this.projectFrom(content, path, readOnlyReason)
    await this.replaceCurrent(project)
    this.rememberRecent()
    return this.summary()!
  }

  async save(): Promise<ProjectSummary> {
    const p = this.require()
    if (!p.path) throw new NoSavePathError()
    return this.writeTo(p.path)
  }

  async saveAs(path: string): Promise<ProjectSummary> {
    this.require()
    return this.writeTo(path)
  }

  async close(): Promise<void> {
    if (!this.current) return
    await this.deps.autosave.remove(this.current.id)
    this.current = null
    this.emit('changed', null)
  }

  /** Writes a recovery copy when there are unsaved changes. Returns true when a copy was written. */
  async autosaveNow(): Promise<boolean> {
    const p = this.current
    if (!p || !this.isDirty() || p.readOnlyReason) return false
    await this.deps.autosave.write(p.id, this.buildContent(p), p.path)
    return true
  }

  async recoveryItems(): Promise<RecoveryItem[]> {
    const open = this.current?.id
    return (await this.deps.autosave.list())
      .filter((e) => e.id !== open)
      .map((e) => ({
        id: e.id,
        company: e.manifest.company.name || '(unnamed company)',
        fy: fyLabel(e.manifest.filing.cy),
        savedAt: e.savedAt,
        originalPath: e.originalPath,
      }))
  }

  async recover(id: string): Promise<ProjectSummary> {
    const { content, originalPath } = await this.deps.autosave.read(id)
    const project = await this.projectFrom(content, originalPath, null)
    project.savedRevision = -1 // recovered work is unsaved by definition
    await this.replaceCurrent(project)
    return this.summary()!
  }

  async discardRecovery(id: string): Promise<void> {
    await this.deps.autosave.remove(id)
  }

  // ---------------------------------------------------------------- internals
  private require(): OpenProject {
    if (!this.current) throw new NoProjectError()
    return this.current
  }

  private async projectFrom(content: AxbrlContent, path: string | null, readOnlyReason: string | null): Promise<OpenProject> {
    const loaded = await this.deps.authority.load()
    if (content.manifest.taxonomy.id !== loaded.taxonomyId) {
      throw new ValidationError([`This filing uses the ${content.manifest.taxonomy.id} taxonomy, which this version does not support yet.`])
    }
    const filing = Filing.fromJSON(loaded.authority, content.filing)
    const session = new Session(loaded.authority, filing)
    return {
      id: content.manifest.projectId || this.newId(),
      path,
      session,
      content,
      savedRevision: session.filing.revision,
      extraDirty: false,
      contentRevision: 0,
      readOnlyReason,
      loaded,
    }
  }

  private buildContent(p: OpenProject): AxbrlContent {
    const meta = p.session.filing.meta as {
      name: string; cin: string; reportType: string; level: string; firstFinancialYear: boolean
      periods: { cy: { start: string; end: string }; py: { start: string; end: string } }
    }
    const manifest: AxbrlManifest = {
      ...p.content.manifest,
      format: AXBRL_FORMAT,
      formatVersion: AXBRL_FORMAT_VERSION,
      appVersion: this.deps.appVersion,
      projectId: p.id,
      updatedAt: this.clock.now().toISOString(),
      taxonomy: { id: p.loaded.taxonomyId, authorityHash: p.loaded.hash },
      company: { name: meta.name, cin: meta.cin },
      filing: {
        reportType: meta.reportType,
        cy: { ...meta.periods.cy },
        py: meta.firstFinancialYear ? null : { ...meta.periods.py },
        firstFinancialYear: meta.firstFinancialYear,
        roundingLevel: meta.level,
      },
    }
    return { ...p.content, manifest, filing: p.session.filing.toJSON() }
  }

  private async writeTo(path: string): Promise<ProjectSummary> {
    const p = this.require()
    if (p.readOnlyReason) throw new ReadOnlyProjectError(p.readOnlyReason)
    const content = this.buildContent(p)
    await writeAxbrl(path, content)
    p.content = content
    p.path = path
    p.savedRevision = p.session.filing.revision
    p.extraDirty = false
    await this.deps.autosave.remove(p.id)
    this.rememberRecent()
    this.emitChanged()
    return this.summary()!
  }

  private async replaceCurrent(next: OpenProject): Promise<void> {
    if (this.current && this.current.id !== next.id) await this.deps.autosave.remove(this.current.id)
    this.current = next
    this.emitChanged()
  }

  private rememberRecent(): void {
    const s = this.summary()
    if (!s?.path) return
    this.deps.recents.touch({ path: s.path, company: s.company.name, cin: s.company.cin, fy: s.fyLabel, openedAt: this.clock.now().toISOString() })
  }

  /** Call after any engine mutation so listeners (title bar, status bar) refresh. */
  emitChanged(): void {
    this.emit('changed', this.summary())
  }
}

/** Pure validation of the New Filing form; returns user-facing problems. */
export function validateNewFiling(input: NewFilingInput): string[] {
  const problems: string[] = []
  if (!input.companyName?.trim()) problems.push('Enter the company name.')
  if (!isValidCin(input.cin ?? '')) problems.push('Enter a valid 21-character CIN (e.g. U72200KA2010PTC123456).')
  if (input.reportType !== 'Standalone' && input.reportType !== 'Consolidated') problems.push('Choose Standalone or Consolidated.')
  if (!ROUNDING_LEVELS.includes(input.level)) problems.push('Choose a level of rounding.')
  problems.push(...validateFilingPeriods(input.cy, input.py))
  return problems
}
