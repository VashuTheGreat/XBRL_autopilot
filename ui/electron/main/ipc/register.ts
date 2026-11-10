/** Thin IPC controllers: validate input, delegate to services, return Results. */
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { dialog, type BrowserWindow } from 'electron'
import type { MappingStatus, Scope, TagCellInput } from '@shared/editor'
import { IPC, type AppInfo, type HttpMethod } from '@shared/ipc'
import type { AppSettings, NewFilingInput } from '@shared/project'
import type { ProjectController } from '../project/project-controller'
import type { EditorQueryService } from '../services/editor-query-service'
import type { MappingService } from '../services/mapping-service'
import type { SourceService } from '../services/source-service'
import type { TaxonomyService } from '../services/taxonomy-service'
import type { ProjectService } from '../services/project-service'
import type { SettingsService } from '../services/settings-service'
import type { SidecarManager } from '../sidecar'
import { handleQuery, handleResult, requireString } from './handle'

export interface IpcDeps {
  appInfo: () => AppInfo
  sidecar: SidecarManager
  projects: ProjectService
  projectController: ProjectController
  settings: SettingsService
  sources: SourceService
  mapping: MappingService
  editor: EditorQueryService
  taxonomy: TaxonomyService
  getWindow: () => BrowserWindow | null
}

export function registerIpc(d: IpcDeps): void {
  registerAppIpc(d)
  registerSidecarIpc(d)
  registerProjectIpc(d)
  registerSettingsIpc(d)
  registerEditorIpc(d)
}

function registerAppIpc(d: IpcDeps): void {
  handleQuery(IPC.appInfo, () => d.appInfo())
}

function registerSidecarIpc({ sidecar }: IpcDeps): void {
  const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE']
  handleQuery(IPC.sidecarStatus, () => sidecar.getStatus())
  handleQuery(IPC.sidecarLogs, () => sidecar.getLogs())
  handleQuery(IPC.sidecarRestart, () => sidecar.restart())
  handleQuery(IPC.sidecarRequest, (_e, method: unknown, path: unknown, body: unknown) => {
    if (!methods.includes(method as HttpMethod) || typeof path !== 'string') throw new Error('Invalid sidecar request')
    return sidecar.request(method as HttpMethod, path, body)
  })
}

function registerProjectIpc({ projects, projectController: pc, taxonomy }: IpcDeps): void {
  handleQuery(IPC.projectCurrent, () => projects.summary())
  handleQuery(IPC.projectRecent, () => projects.recentProjects())
  handleQuery(IPC.projectForgetRecent, (_e, path: unknown) => projects.forgetRecent(requireString(path, 'path')))
  handleQuery(IPC.projectRecovery, () => projects.recoveryItems())
  handleQuery(IPC.projectDiscardRecovery, (_e, id: unknown) => projects.discardRecovery(requireString(id, 'id')))
  handleResult(IPC.projectCreate, (_e, input: NewFilingInput) => pc.create(input))
  handleResult(IPC.projectOpen, (_e, path?: unknown) => pc.open(path === undefined ? undefined : requireString(path, 'path')))
  handleResult(IPC.projectSave, () => pc.save())
  handleResult(IPC.projectSaveAs, () => pc.saveAs())
  handleResult(IPC.projectClose, () => pc.close())
  handleResult(IPC.projectRecover, (_e, id: unknown) => pc.recover(requireString(id, 'id')))
  handleResult(IPC.projectElrs, () => taxonomy.elrs())
}

function registerSettingsIpc({ settings, getWindow }: IpcDeps): void {
  handleQuery(IPC.settingsGet, () => settings.state())
  handleResult(IPC.settingsUpdate, (_e, patch: Partial<AppSettings>) => settings.update(patch ?? {}))
  handleResult(IPC.settingsSetGroqKey, (_e, key: unknown) => settings.setGroqKey(requireString(key, 'key')))
  handleResult(IPC.settingsClearGroqKey, () => settings.clearGroqKey())
  handleResult(IPC.settingsPickMcaTool, async () => {
    const win = getWindow()
    const opts = {
      title: 'Locate the MCA XBRL Validation Tool',
      properties: ['openFile' as const],
      filters: [{ name: 'Program', extensions: ['exe'] }],
    }
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return canceled || !filePaths[0] ? null : settings.update({ mcaToolPath: filePaths[0] })
  })
}

const SCOPES: Scope[] = ['CY', 'PY']
const STATUSES: MappingStatus[] = ['suggested', 'approved', 'rejected']

function registerEditorIpc({ sources, mapping, editor, taxonomy, getWindow }: IpcDeps): void {
  handleResult(IPC.workbookImport, async (_e, path?: unknown) => {
    if (path !== undefined) {
      const file = requireString(path, 'path')
      if (!/\.(xlsx|xlsm|xls)$/i.test(file)) throw new Error('Only Excel workbooks (.xlsx) can be imported.')
      return sources.importWorkbook(basename(file), new Uint8Array(await readFile(file)))
    }
    const win = getWindow()
    const opts = {
      title: 'Import Excel financial statements',
      properties: ['openFile' as const],
      filters: [{ name: 'Excel workbook', extensions: ['xlsx', 'xlsm', 'xls'] }],
    }
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const file = canceled ? null : filePaths[0]
    return file ? sources.importWorkbook(basename(file), new Uint8Array(await readFile(file))) : null
  })
  handleResult(IPC.workbookList, () => sources.workbooks())
  handleResult(IPC.mappingList, () => mapping.list())
  handleResult(IPC.mappingTag, (_e, input: TagCellInput) => {
    if (!input?.cell || typeof input.concept !== 'string') throw new Error('Invalid tag request')
    return mapping.tag(input)
  })
  handleResult(IPC.mappingUntag, (_e, id: unknown) => mapping.untag(requireString(id, 'id')))
  handleResult(IPC.mappingSetScope, (_e, id: unknown, scope: Scope) => {
    if (!SCOPES.includes(scope)) throw new Error('Invalid scope')
    return mapping.setScope(requireString(id, 'id'), scope)
  })
  handleResult(IPC.mappingSetStatus, (_e, id: unknown, status: MappingStatus) => {
    if (!STATUSES.includes(status)) throw new Error('Invalid status')
    return mapping.setStatus(requireString(id, 'id'), status)
  })
  handleResult(IPC.editorForm, (_e, uri: unknown) => editor.form(requireString(uri, 'statement')))
  handleResult(IPC.editorXml, () => editor.xml())
  handleResult(IPC.taxonomySearch, (_e, q: unknown) => taxonomy.searchConcepts(typeof q === 'string' ? q.slice(0, 200) : ''))
}
