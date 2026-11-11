import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type MenuCommand, type SidecarLogLine, type SidecarStatus, type XapApi } from '@shared/ipc'
import type { ProjectSummary, SettingsState } from '@shared/project'

const invoke = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: XapApi = {
  app: {
    info: () => invoke(IPC.appInfo),
  },
  sidecar: {
    status: () => invoke(IPC.sidecarStatus),
    logs: () => invoke(IPC.sidecarLogs),
    restart: () => invoke(IPC.sidecarRestart),
    request: (method, path, body) => invoke(IPC.sidecarRequest, method, path, body),
    onStatus: (cb) => subscribe<SidecarStatus>(IPC.sidecarStatusChanged, cb),
    onLog: (cb) => subscribe<SidecarLogLine>(IPC.sidecarLog, cb),
  },
  menu: {
    onCommand: (cb) => subscribe<MenuCommand>(IPC.menuCommand, cb),
  },
  project: {
    current: () => invoke(IPC.projectCurrent),
    create: (input) => invoke(IPC.projectCreate, input),
    open: (path) => invoke(IPC.projectOpen, path),
    importXbrl: (mode, path) => invoke(IPC.projectImportXbrl, mode, path),
    save: () => invoke(IPC.projectSave),
    saveAs: () => invoke(IPC.projectSaveAs),
    close: () => invoke(IPC.projectClose),
    recent: () => invoke(IPC.projectRecent),
    forgetRecent: (path) => invoke(IPC.projectForgetRecent, path),
    recovery: () => invoke(IPC.projectRecovery),
    recover: (id) => invoke(IPC.projectRecover, id),
    discardRecovery: (id) => invoke(IPC.projectDiscardRecovery, id),
    elrs: () => invoke(IPC.projectElrs),
    setStatementPlaces: (places) => invoke(IPC.projectSetStatementPlaces, places),
    onChanged: (cb) => subscribe<ProjectSummary | null>(IPC.projectChanged, cb),
  },
  settings: {
    get: () => invoke(IPC.settingsGet),
    update: (patch) => invoke(IPC.settingsUpdate, patch),
    setGroqKey: (key) => invoke(IPC.settingsSetGroqKey, key),
    clearGroqKey: () => invoke(IPC.settingsClearGroqKey),
    pickMcaTool: () => invoke(IPC.settingsPickMcaTool),
    onChanged: (cb) => subscribe<SettingsState>(IPC.settingsChanged, cb),
  },
  editor: {
    importWorkbook: (path) => invoke(IPC.workbookImport, path),
    workbooks: () => invoke(IPC.workbookList),
    mappings: () => invoke(IPC.mappingList),
    tag: (input) => invoke(IPC.mappingTag, input),
    untag: (id) => invoke(IPC.mappingUntag, id),
    setScope: (id, scope) => invoke(IPC.mappingSetScope, id, scope),
    setStatus: (id, status) => invoke(IPC.mappingSetStatus, id, status),
    cellInfo: (cell) => invoke(IPC.mappingCellInfo, cell),
    setColumnPeriod: (cell, scope) => invoke(IPC.mappingSetColumnPeriod, cell, scope),
    form: (elrUri) => invoke(IPC.editorForm, elrUri),
    xml: () => invoke(IPC.editorXml),
    fillMandatoryZeros: (elrUri) => invoke(IPC.editorFillMandatoryZeros, elrUri),
    searchConcepts: (query) => invoke(IPC.taxonomySearch, query),
    autoTag: () => invoke(IPC.autotagRun),
    acceptSuggestion: (id, concept) => invoke(IPC.autotagAccept, id, concept),
    rejectSuggestion: (id) => invoke(IPC.autotagReject, id),
    acceptAllSuggestions: (min) => invoke(IPC.autotagAcceptAll, min),
  },
}

contextBridge.exposeInMainWorld('xap', api)
