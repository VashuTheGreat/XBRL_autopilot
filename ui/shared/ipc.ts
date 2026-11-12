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
import type {
  AcceptAllResult,
  AlsoReportInput,
  AutoTagColumnOptions,
  AutoTagSummary,
  BlockSuggestion,
  CellInfo,
  ColumnPeriod,
  SetSheetColumnsInput,
  SheetColumns,
  ZeroFilled,
  ConceptHit,
  FormView,
  MappingStatus,
  MappingView,
  Scope,
  TableBlock,
  TableBlockInput,
  TableBlockPlan,
  TableBlockResult,
  TableInfo,
  TableStructure,
  TableZeroFilled,
  TagCellInput,
  XmlView,
} from './editor'
import type { CellRef, WorkbookModel } from './workbook'
import type { McaLaunchResult, ValidationView } from './validation'
import type { AiHistoryEntry, AiView } from './ai'

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
  mappingSheetColumns: 'mapping:sheet-columns',
  mappingSetSheetColumns: 'mapping:set-sheet-columns',
  mappingAlsoAdd: 'mapping:also-add',
  mappingAlsoRemove: 'mapping:also-remove',
  tableCatalog: 'table:catalog',
  tableStructure: 'table:structure',
  tablePlan: 'table:plan',
  tableApply: 'table:apply',
  tableList: 'table:list',
  tableRemove: 'table:remove',
  autotagRun: 'autotag:run',
  autotagAccept: 'autotag:accept',
  autotagReject: 'autotag:reject',
  autotagAcceptAll: 'autotag:accept-all',
  autotagBlocks: 'autotag:blocks',
  autotagAcceptBlock: 'autotag:accept-block',
  autotagRejectBlock: 'autotag:reject-block',
  autotagAcceptAlso: 'autotag:accept-also',
  autotagRejectAlso: 'autotag:reject-also',
  editorForm: 'editor:form',
  editorXml: 'editor:xml',
  editorFillMandatoryZeros: 'editor:fill-mandatory-zeros',
  editorFillTableZeros: 'editor:fill-table-zeros',
  editorPrefillDisclosures: 'editor:prefill-disclosures',
  taxonomySearch: 'taxonomy:search',
  validationGet: 'validation:get',
  validationRun: 'validation:run',
  validationFix: 'validation:fix',
  validationImportMca: 'validation:import-mca',
  validationClearMca: 'validation:clear-mca',
  validationChanged: 'validation:changed',
  toolsLaunchMca: 'tools:launch-mca',
  aiGet: 'ai:get',
  aiPropose: 'ai:propose',
  aiFixAll: 'ai:fix-all',
  aiStop: 'ai:stop',
  aiAccept: 'ai:accept',
  aiReject: 'ai:reject',
  aiClear: 'ai:clear',
  aiHistory: 'ai:history',
  aiChanged: 'ai:changed',
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
    /** gets the sheet's configured or inferred CY and PY columns */
    sheetColumns(workbook: string, sheet: string): Promise<Result<SheetColumns>>
    /** sets the sheet's CY and PY figure columns */
    setSheetColumns(input: SetSheetColumnsInput): Promise<Result<SheetColumns>>
    form(elrUri: string): Promise<Result<FormView>>
    xml(): Promise<Result<XmlView>>
    /** reports the statement's empty mandatory amounts as 0; returns what was filled */
    fillMandatoryZeros(elrUri: string): Promise<Result<ZeroFilled[]>>
    /** in the statement's tables, reports the line items the rules require as 0 in columns that have a value */
    fillTableZeros(elrUri: string): Promise<Result<TableZeroFilled[]>>
    /** prefills disclosure / filing details from last year's instance / set-aside facts */
    prefillDisclosures(elrUri?: string): Promise<Result<{ copied: number; skipped: { concept: string; reason: string }[] }>>
    /** "also reported as": files the tagged cell's figure as one more fact */
    addAlso(input: AlsoReportInput): Promise<Result<MappingView>>
    removeAlso(mappingId: string, index: number): Promise<Result<MappingView>>
    /** the taxonomy's tables with axes, and one table's line items and members (Map as table) */
    tables(): Promise<Result<TableInfo[]>>
    tableStructure(tableId: string): Promise<Result<TableStructure>>
    /** what mapping a range to a table would file, cell by cell (no changes) */
    planTable(input: TableBlockInput): Promise<Result<TableBlockPlan>>
    applyTable(input: TableBlockInput): Promise<Result<TableBlockResult>>
    tableBlocks(): Promise<Result<TableBlock[]>>
    removeTable(blockId: string): Promise<Result<void>>
    searchConcepts(query: string): Promise<Result<ConceptHit[]>>
    /** asks the tagger for every imported workbook; stores suggestions (status 'suggested'), writes no fact */
    autoTag(opts?: AutoTagColumnOptions): Promise<Result<AutoTagSummary>>
    /** tags a suggested cell with its suggestion, or with `concept` (one of its alternatives) */
    acceptSuggestion(id: string, concept?: string): Promise<Result<MappingView>>
    rejectSuggestion(id: string): Promise<Result<MappingView>>
    /** accepts every suggestion with confidence ≥ `min` (default 0.9) */
    acceptAllSuggestions(min?: number): Promise<Result<AcceptAllResult>>
    /** the table blocks auto-tagging suggested (open and rejected) */
    blockSuggestions(): Promise<Result<BlockSuggestion[]>>
    /** applies a suggested block as suggested, or as edited in "Map as table" */
    acceptBlock(id: string, edited?: TableBlockInput): Promise<Result<TableBlockResult>>
    rejectBlock(id: string): Promise<Result<BlockSuggestion>>
    /** files / drops one suggested "also reported as" fact of a tagged cell (by its index in `alsoSuggested`) */
    acceptAlso(mappingId: string, index: number): Promise<Result<MappingView>>
    rejectAlso(mappingId: string, index: number): Promise<Result<MappingView>>
  }
  /** Phase 9: live validation, quick fixes, MCA Validation Tool */
  validation: {
    /** the latest run (revalidated automatically after every change) */
    get(): Promise<ValidationView>
    run(): Promise<Result<ValidationView>>
    /** applies the deterministic quick fix of a problem of the latest run */
    fix(problemId: string): Promise<Result<ValidationView>>
    /** the MCA tool's error list: pasted text, or a file dialog when omitted; `null` = cancelled */
    importMca(text?: string): Promise<Result<ValidationView | null>>
    clearMca(): Promise<Result<ValidationView>>
    /** writes output/NNN.xml and starts the MCA XBRL Validation Tool */
    launchMca(): Promise<Result<McaLaunchResult>>
    onChanged(cb: (v: ValidationView) => void): () => void
  }
  /** Phase 10: AI fix agent (proposals only; the user accepts each patch) */
  ai: {
    get(): Promise<AiView>
    /** Ask AI about one problem of the latest validation run */
    propose(problemId: string): Promise<Result<AiView>>
    /** starts the Fix all loop (runs in the background; progress arrives through onChanged) */
    fixAll(): Promise<Result<AiView>>
    stop(): Promise<Result<AiView>>
    /** applies a patch; `input` = the value the user typed / edited, `confirmed` = explicit confirmation */
    accept(cardId: string, opts?: { input?: string; confirmed?: boolean }): Promise<Result<AiView>>
    reject(cardId: string, reason?: string): Promise<Result<AiView>>
    /** removes proposals that have no open patch */
    clear(): Promise<Result<AiView>>
    /** the newest ai/history.jsonl entries (what was sent, what came back, decisions) */
    history(): Promise<Result<AiHistoryEntry[]>>
    onChanged(cb: (v: AiView) => void): () => void
  }
}
