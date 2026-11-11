/** Thin IPC controllers: validate input, delegate to services, return Results. */
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { dialog, type BrowserWindow } from 'electron'
import type { MappingStatus, Scope, TagCellInput } from '@shared/editor'
import { IPC, type AppInfo, type HttpMethod } from '@shared/ipc'
import type { CellRef } from '@shared/workbook'
import type { AppSettings, NewFilingInput } from '@shared/project'
import type { ProjectController } from '../project/project-controller'
import type { AutoTagService } from '../services/auto-tag-service'
import type { ColumnPeriodService } from '../services/column-period-service'
import type { EditorQueryService } from '../services/editor-query-service'
import type { FilingPropertiesService } from '../services/filing-properties-service'
import type { MappingService } from '../services/mapping-service'
import type { SourceService } from '../services/source-service'
import type { StatementService } from '../services/statement-service'
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
  columns: ColumnPeriodService
  filing: FilingPropertiesService
  statements: StatementService
  taxonomy: TaxonomyService
  autoTag: AutoTagService
  getWindow: () => BrowserWindow | null
}

export function registerIpc(d: IpcDeps): void {
  registerAppIpc(d)
  registerSidecarIpc(d)
  registerProjectIpc(d)
  registerSettingsIpc(d)
  registerEditorIpc(d)
  registerAutoTagIpc(d)
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

function registerProjectIpc({ projects, projectController: pc, taxonomy, filing }: IpcDeps): void {
  handleQuery(IPC.projectCurrent, () => projects.summary())
  handleQuery(IPC.projectRecent, () => projects.recentProjects())
  handleQuery(IPC.projectForgetRecent, (_e, path: unknown) => projects.forgetRecent(requireString(path, 'path')))
  handleQuery(IPC.projectRecovery, () => projects.recoveryItems())
  handleQuery(IPC.projectDiscardRecovery, (_e, id: unknown) => projects.discardRecovery(requireString(id, 'id')))
  handleResult(IPC.projectCreate, (_e, input: NewFilingInput) => pc.create(input))
  handleResult(IPC.projectOpen, (_e, path?: unknown) => pc.open(path === undefined ? undefined : requireString(path, 'path')))
  handleResult(IPC.projectImportXbrl, (_e, mode: unknown, path?: unknown) => {
    if (mode !== 'both' && mode !== 'next') throw new Error('Unknown import mode')
    return pc.importInstance(mode, path === undefined ? undefined : requireString(path, 'path'))
  })
  handleResult(IPC.projectSave, () => pc.save())
  handleResult(IPC.projectSaveAs, () => pc.saveAs())
  handleResult(IPC.projectClose, () => pc.close())
  handleResult(IPC.projectRecover, (_e, id: unknown) => pc.recover(requireString(id, 'id')))
  handleResult(IPC.projectElrs, () => taxonomy.elrs())
  handleResult(IPC.projectSetStatementPlaces, (_e, places: unknown) => {
    if (typeof places !== 'number') throw new Error('Invalid decimal places')
    return filing.setStatementPlaces(places)
  })
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

/** A CellRef from the renderer: three non-empty strings, nothing else kept. */
function requireCell(v: unknown): CellRef {
  const c = v as Partial<CellRef> | null
  if (!c || typeof c !== 'object') throw new Error('Invalid cell')
  return { workbook: requireString(c.workbook, 'workbook'), sheet: requireString(c.sheet, 'sheet'), ref: requireString(c.ref, 'cell reference') }
}

function registerEditorIpc({ sources, mapping, columns, editor, statements, taxonomy, getWindow }: IpcDeps): void {
  handleResult(IPC.workbookImport, async (_e, path?: unknown) => {
    if (path !== undefined) {
      const file = requireString(path, 'path')
      if (!/\.(xlsx|xlsm|xls)$/i.test(file)) throw new Error('Only Excel workbooks (.xlsx, .xlsm, .xls) can be imported.')
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
  handleResult(IPC.mappingCellInfo, (_e, cell: unknown) => mapping.cellInfo(requireCell(cell)))
  handleResult(IPC.mappingSetColumnPeriod, (_e, cell: unknown, scope: unknown) => {
    if (scope !== null && !SCOPES.includes(scope as Scope)) throw new Error('Invalid scope')
    return columns.set(requireCell(cell), scope as Scope | null)
  })
  handleResult(IPC.editorForm, (_e, uri: unknown) => editor.form(requireString(uri, 'statement')))
  handleResult(IPC.editorXml, () => editor.xml())
  handleResult(IPC.editorFillMandatoryZeros, (_e, uri: unknown) => statements.fillMandatoryZeros(requireString(uri, 'statement')))
  handleResult(IPC.taxonomySearch, (_e, q: unknown) => taxonomy.searchConcepts(typeof q === 'string' ? q.slice(0, 200) : ''))
}

function registerAutoTagIpc({ autoTag }: IpcDeps): void {
  handleResult(IPC.autotagRun, () => autoTag.run())
  handleResult(IPC.autotagAccept, (_e, id: unknown, concept?: unknown) =>
    autoTag.accept(requireString(id, 'id'), concept === undefined || concept === null ? undefined : requireString(concept, 'concept')),
  )
  handleResult(IPC.autotagReject, (_e, id: unknown) => autoTag.reject(requireString(id, 'id')))
  handleResult(IPC.autotagAcceptAll, (_e, min?: unknown) => {
    if (min !== undefined && (typeof min !== 'number' || !(min >= 0 && min <= 1))) throw new Error('Invalid confidence')
    return autoTag.acceptAll(min as number | undefined)
  })
}
