/** Shared IPC contract between main, preload and renderer. See docs/09-ipc-and-sidecar-api.md. */
import type {
  AppSettings,
  ElrInfo,
  ImportReportView,
  InstanceImportMode,
  NewFilingInput,
  ProjectSummary,
  RecentProject,
  RecoveryItem,
  SettingsState,
} from './project'
import type { CellInfo, ColumnPeriod, ZeroFilled, ConceptHit, FormView, MappingStatus, MappingView, Scope, TagCellInput, XmlView } from './editor'
import type { CellRef, WorkbookModel } from './workbook'

/**
 * Every fallible IPC call returns a Result instead of throwing: Electron flattens thrown errors into
 * "Error invoking remote method …" and drops their type, which the UI needs (e.g. form problems).
 */
export type IpcError = { kind: 'validation'; message: string; problems: string[] } | { kind: 'error'; message: string }
export type Result<T> = { ok: true; value: T } | { ok: false; error: IpcError }

export type SidecarStatus =
  | { state: 'starting' }
  | { state: 'ready'; port: number; version: string; aiEnabled: boolean; model: string | null }
  | { state: 'error'; message: string }
  | { state: 'stopped' }

export interface SidecarLogLine {
  ts: number
  stream: 'stdout' | 'stderr' | 'system'
  text: string
}

export interface AppInfo {
  name: string
  version: string
  platform: string
  isDev: boolean
}

export interface SidecarResponse<T = unknown> {
  status: number
  data: T
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export type MenuCommand =
  | 'file:new'
  | 'file:open'
  | 'file:save'
  | 'file:save-as'
  | 'file:import-excel'
  | 'file:import-xbrl'
  | 'filing:validate'
  | 'filing:generate-xml'
  | 'view:toggle-sidebar'
  | 'view:toggle-bottom'
  | 'view:quick-switch'
  | 'tools:open-mca-validator'
  | 'tools:settings'

export const IPC = {
  appInfo: 'app:info',
  sidecarStatus: 'sidecar:status',
  sidecarStatusChanged: 'sidecar:status-changed',
  sidecarLog: 'sidecar:log',
  sidecarLogs: 'sidecar:logs',
  sidecarRequest: 'sidecar:request',
  sidecarRestart: 'sidecar:restart',
  menuCommand: 'menu:command',
  projectCurrent: 'project:current',
  projectCreate: 'project:create',
  projectOpen: 'project:open',
  projectImportXbrl: 'project:import-xbrl',
  projectSave: 'project:save',
  projectSaveAs: 'project:save-as',
  projectClose: 'project:close',
  projectRecent: 'project:recent',
  projectForgetRecent: 'project:forget-recent',
  projectRecovery: 'project:recovery',
  projectRecover: 'project:recover',
  projectDiscardRecovery: 'project:discard-recovery',
  projectElrs: 'project:elrs',
  projectSetStatementPlaces: 'project:set-statement-places',
  projectChanged: 'project:changed',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsSetGroqKey: 'settings:set-groq-key',
  settingsClearGroqKey: 'settings:clear-groq-key',
  settingsPickMcaTool: 'settings:pick-mca-tool',
  settingsChanged: 'settings:changed',
  workbookImport: 'workbook:import',
  workbookList: 'workbook:list',
  mappingList: 'mapping:list',
  mappingTag: 'mapping:tag',
  mappingUntag: 'mapping:untag',
  mappingSetScope: 'mapping:set-scope',
  mappingSetStatus: 'mapping:set-status',
  mappingCellInfo: 'mapping:cell-info',
  mappingSetColumnPeriod: 'mapping:set-column-period',
  editorForm: 'editor:form',
  editorXml: 'editor:xml',
  editorFillMandatoryZeros: 'editor:fill-mandatory-zeros',
  taxonomySearch: 'taxonomy:search',
} as const

/** The API exposed on window.xap by the preload script. */
export interface XapApi {
  app: { info(): Promise<AppInfo> }
  sidecar: {
    status(): Promise<SidecarStatus>
    logs(): Promise<SidecarLogLine[]>
    restart(): Promise<void>
    request<T = unknown>(method: HttpMethod, path: string, body?: unknown): Promise<SidecarResponse<T>>
    onStatus(cb: (s: SidecarStatus) => void): () => void
    onLog(cb: (l: SidecarLogLine) => void): () => void
  }
  menu: { onCommand(cb: (c: MenuCommand) => void): () => void }
  project: {
    current(): Promise<ProjectSummary | null>
    create(input: NewFilingInput): Promise<Result<ProjectSummary | null>>
    /** no path → file dialog; `null` value = cancelled */
    open(path?: string): Promise<Result<ProjectSummary | null>>
    /** a filing from an existing XBRL instance; no path → file dialog; `null` value = cancelled */
    importXbrl(mode: InstanceImportMode, path?: string): Promise<Result<{ summary: ProjectSummary; report: ImportReportView } | null>>
    /** Save As dialog when the filing was never saved; `null` value = cancelled */
    save(): Promise<Result<ProjectSummary | null>>
    saveAs(): Promise<Result<ProjectSummary | null>>
    /** asks to save unsaved changes first; `false` = the user cancelled */
    close(): Promise<Result<boolean>>
    recent(): Promise<RecentProject[]>
    forgetRecent(path: string): Promise<void>
    recovery(): Promise<RecoveryItem[]>
    recover(id: string): Promise<Result<ProjectSummary | null>>
    discardRecovery(id: string): Promise<void>
    elrs(): Promise<Result<ElrInfo[]>>
    /** "decimal places as presented"; re-pulls tagged figures from Excel. Value = tags that kept their old value */
    setStatementPlaces(places: number): Promise<Result<string[]>>
    onChanged(cb: (s: ProjectSummary | null) => void): () => void
  }
  settings: {
    get(): Promise<SettingsState>
    update(patch: Partial<AppSettings>): Promise<Result<SettingsState>>
    setGroqKey(key: string): Promise<Result<SettingsState>>
    clearGroqKey(): Promise<Result<SettingsState>>
    /** file dialog for the MCA Validation Tool exe; `null` = cancelled */
    pickMcaTool(): Promise<Result<SettingsState | null>>
    onChanged(cb: (s: SettingsState) => void): () => void
  }
  editor: {
    /** no path → file dialog (also used for drag-and-drop); `null` value = cancelled */
    importWorkbook(path?: string): Promise<Result<WorkbookModel | null>>
    workbooks(): Promise<Result<WorkbookModel[]>>
    mappings(): Promise<Result<MappingView[]>>
    tag(input: TagCellInput): Promise<Result<MappingView>>
    untag(id: string): Promise<Result<void>>
    setScope(id: string, scope: Scope): Promise<Result<MappingView>>
    setStatus(id: string, status: MappingStatus): Promise<Result<MappingView>>
    /** the cell's amount (rounded to the statement's precision) and its column's period */
    cellInfo(cell: CellRef): Promise<Result<CellInfo>>
    /** remembers the period of the cell's column on its sheet; null forgets the choice */
    setColumnPeriod(cell: CellRef, scope: Scope | null): Promise<Result<ColumnPeriod>>
    form(elrUri: string): Promise<Result<FormView>>
    xml(): Promise<Result<XmlView>>
    /** reports the statement's empty mandatory amounts as 0; returns what was filled */
    fillMandatoryZeros(elrUri: string): Promise<Result<ZeroFilled[]>>
    searchConcepts(query: string): Promise<Result<ConceptHit[]>>
  }
}
