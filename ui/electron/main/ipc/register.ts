/** Thin IPC controllers: validate input, delegate to services, return Results. */
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { dialog, type BrowserWindow } from 'electron'
import type { AutoTagColumnOptions, MappingStatus, Scope, SetSheetColumnsInput } from '@shared/editor'
import { IPC, type AppInfo, type HttpMethod } from '@shared/ipc'
import type { AppSettings, NewFilingInput } from '@shared/project'
import type { ProjectController } from '../project/project-controller'
import type { AutoTagService } from '../services/auto-tag-service'
import type { ColumnPeriodService } from '../services/column-period-service'
import type { EditorQueryService } from '../services/editor-query-service'
import type { FilingPropertiesService } from '../services/filing-properties-service'
import type { MappingService } from '../services/mapping-service'
import type { SourceService } from '../services/source-service'
import type { StatementService } from '../services/statement-service'
import type { TableMappingService } from '../services/table-mapping-service'
import type { TableSuggestionService } from '../services/table-suggestion-service'
import type { TaxonomyService } from '../services/taxonomy-service'
import type { McaToolService } from '../services/mca-tool-service'
import type { ValidationService } from '../services/validation-service'
import type { FixAgentService } from '../services/fix-agent-service'
import type { ProjectService } from '../services/project-service'
import type { SettingsService } from '../services/settings-service'
import type { SidecarManager } from '../sidecar'
import { capWorkbook } from '../infra/workbook-parser'
import { handleQuery, handleResult, requireString } from './handle'
import { requireAlsoInput, requireBlockInput, requireCell, requireIndex, requireTagInput } from './table-input'

export interface IpcDeps {
  appInfo: () => AppInfo
  sidecar: SidecarManager
  projects: ProjectService
  projectController: ProjectController
  settings: SettingsService
  sources: SourceService
  mapping: MappingService
  tables: TableMappingService
  editor: EditorQueryService
  columns: ColumnPeriodService
  filing: FilingPropertiesService
  statements: StatementService
  taxonomy: TaxonomyService
  autoTag: AutoTagService
  tableSuggestions: TableSuggestionService
  validation: ValidationService
  mcaTool: McaToolService
  fixAgent: FixAgentService
  getWindow: () => BrowserWindow | null
}

export function registerIpc(d: IpcDeps): void {
  registerAppIpc(d)
  registerSidecarIpc(d)
  registerProjectIpc(d)
  registerSettingsIpc(d)
  registerEditorIpc(d)
  registerAutoTagIpc(d)
  registerValidationIpc(d)
  registerAiIpc(d)
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

function registerEditorIpc({ sources, mapping, tables, columns, editor, statements, taxonomy, getWindow }: IpcDeps): void {
  handleResult(IPC.workbookImport, async (_e, path?: unknown) => {
    if (path !== undefined) {
      const file = requireString(path, 'path')
      if (!/\.(xlsx|xlsm|xls)$/i.test(file)) throw new Error('Only Excel workbooks (.xlsx, .xlsm, .xls) can be imported.')
      const wb = await sources.importWorkbook(basename(file), new Uint8Array(await readFile(file)))
      return capWorkbook(wb)
    }
    const win = getWindow()
    const opts = {
      title: 'Import Excel financial statements',
      properties: ['openFile' as const],
      filters: [{ name: 'Excel workbook', extensions: ['xlsx', 'xlsm', 'xls'] }],
    }
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const file = canceled ? null : filePaths[0]
    if (!file) return null
    const wb = await sources.importWorkbook(basename(file), new Uint8Array(await readFile(file)))
    return capWorkbook(wb)
  })
  handleResult(IPC.workbookList, async () => {
    const list = await sources.workbooks()
    return list.map((w) => capWorkbook(w))
  })
  handleResult(IPC.mappingList, () => mapping.list())
  handleResult(IPC.mappingTag, (_e, input: unknown) => mapping.tag(requireTagInput(input)))
  handleResult(IPC.mappingAlsoAdd, (_e, input: unknown) => mapping.addAlso(requireAlsoInput(input)))
  handleResult(IPC.mappingAlsoRemove, (_e, id: unknown, i: unknown) => mapping.removeAlso(requireString(id, 'id'), requireIndex(i)))
  handleResult(IPC.tableCatalog, () => tables.tables())
  handleResult(IPC.tableStructure, (_e, id: unknown) => tables.structure(requireString(id, 'table')))
  handleResult(IPC.tablePlan, (_e, input: unknown) => tables.plan(requireBlockInput(input)))
  handleResult(IPC.tableApply, (_e, input: unknown) => tables.apply(requireBlockInput(input)))
  handleResult(IPC.tableList, () => tables.list())
  handleResult(IPC.tableRemove, (_e, id: unknown) => tables.remove(requireString(id, 'table mapping')))
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
  handleResult(IPC.mappingSheetColumns, (_e, workbook: unknown, sheet: unknown) =>
    columns.sheetColumns(requireString(workbook, 'workbook'), requireString(sheet, 'sheet')),
  )
  handleResult(IPC.mappingSetSheetColumns, (_e, input: unknown) =>
    columns.setSheetColumns(requireSetSheetColumnsInput(input)),
  )
  handleResult(IPC.editorForm, (_e, uri: unknown) => editor.form(requireString(uri, 'statement')))
  handleResult(IPC.editorXml, () => editor.xml())
  handleResult(IPC.editorFillMandatoryZeros, (_e, uri: unknown) => statements.fillMandatoryZeros(requireString(uri, 'statement')))
  handleResult(IPC.editorFillTableZeros, (_e, uri: unknown) => statements.fillTableZeros(requireString(uri, 'statement')))
  handleResult(IPC.editorPrefillDisclosures, (_e, uri?: unknown) =>
    statements.prefillDisclosures(uri === undefined || uri === null ? undefined : requireString(uri, 'statement')),
  )
  handleResult(IPC.taxonomySearch, (_e, q: unknown) => taxonomy.searchConcepts(typeof q === 'string' ? q.slice(0, 200) : ''))
}

function registerAutoTagIpc({ autoTag, mapping, tableSuggestions }: IpcDeps): void {
  handleResult(IPC.autotagRun, (_e, opts?: unknown) =>
    opts && typeof opts === 'object' ? autoTag.runColumn(opts as AutoTagColumnOptions) : autoTag.run(),
  )
  handleResult(IPC.autotagAccept, (_e, id: unknown, concept?: unknown) =>
    autoTag.accept(requireString(id, 'id'), concept === undefined || concept === null ? undefined : requireString(concept, 'concept')),
  )
  handleResult(IPC.autotagReject, (_e, id: unknown) => autoTag.reject(requireString(id, 'id')))
  handleResult(IPC.autotagAcceptAll, (_e, min?: unknown) => {
    if (min !== undefined && (typeof min !== 'number' || !(min >= 0 && min <= 1))) throw new Error('Invalid confidence')
    return autoTag.acceptAll(min as number | undefined)
  })
  handleResult(IPC.autotagBlocks, () => tableSuggestions.list())
  handleResult(IPC.autotagAcceptBlock, (_e, id: unknown, edited?: unknown) =>
    tableSuggestions.accept(requireString(id, 'id'), edited === undefined || edited === null ? undefined : requireBlockInput(edited)),
  )
  handleResult(IPC.autotagRejectBlock, (_e, id: unknown) => tableSuggestions.reject(requireString(id, 'id')))
  handleResult(IPC.autotagAcceptAlso, (_e, id: unknown, i: unknown) => mapping.acceptAlso(requireString(id, 'id'), requireIndex(i)))
  handleResult(IPC.autotagRejectAlso, (_e, id: unknown, i: unknown) => mapping.rejectAlso(requireString(id, 'id'), requireIndex(i)))
}

/** MCA error lists are text reports; anything larger is not one. */
const MAX_MCA_TEXT = 2_000_000

function registerValidationIpc({ validation, mcaTool, getWindow }: IpcDeps): void {
  handleQuery(IPC.validationGet, () => validation.view())
  handleResult(IPC.validationRun, () => validation.run())
  handleResult(IPC.validationFix, (_e, id: unknown) => validation.applyFix(requireString(id, 'problem')))
  handleResult(IPC.validationImportMca, async (_e, text?: unknown) => {
    if (text !== undefined && text !== null) {
      const t = requireString(text, 'error list')
      if (t.length > MAX_MCA_TEXT) throw new Error('The error list is too large.')
      return validation.importMcaErrors(t, 'pasted')
    }
    const win = getWindow()
    const opts = {
      title: 'Import the MCA Validation Tool error list',
      properties: ['openFile' as const],
      filters: [{ name: 'Error list', extensions: ['txt', 'log'] }, { name: 'All files', extensions: ['*'] }],
    }
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const file = canceled ? null : filePaths[0]
    if (!file) return null
    const content = await readFile(file, 'utf8')
    if (content.length > MAX_MCA_TEXT) throw new Error('The error list is too large.')
    return validation.importMcaErrors(content, basename(file))
  })
  handleResult(IPC.validationClearMca, () => validation.clearMcaErrors())
  handleResult(IPC.toolsLaunchMca, () => mcaTool.launch())
}

/** Values typed in a review card are short (an amount or a text of at most 200 characters). */
const MAX_AI_INPUT = 400

function registerAiIpc({ fixAgent }: IpcDeps): void {
  handleQuery(IPC.aiGet, () => fixAgent.view())
  handleResult(IPC.aiPropose, (_e, id: unknown) => fixAgent.ask(requireString(id, 'problem')))
  handleResult(IPC.aiFixAll, () => fixAgent.fixAll())
  handleResult(IPC.aiStop, () => fixAgent.stop())
  handleResult(IPC.aiAccept, (_e, id: unknown, opts?: unknown) => {
    const o = (opts ?? {}) as { input?: unknown; confirmed?: unknown }
    if (o.input !== undefined && o.input !== null && (typeof o.input !== 'string' || o.input.length > MAX_AI_INPUT)) throw new Error('Invalid value')
    return fixAgent.accept(requireString(id, 'patch'), { input: (o.input as string | undefined) ?? null, confirmed: o.confirmed === true })
  })
  handleResult(IPC.aiReject, (_e, id: unknown, reason?: unknown) => fixAgent.reject(requireString(id, 'patch'), typeof reason === 'string' ? reason.slice(0, 300) : undefined))
  handleResult(IPC.aiClear, () => fixAgent.clear())
  handleResult(IPC.aiHistory, () => fixAgent.historyEntries())
}

function requireSetSheetColumnsInput(v: unknown): SetSheetColumnsInput {
  if (!v || typeof v !== 'object') throw new Error('Invalid input')
  const o = v as Record<string, unknown>
  const workbook = requireString(o.workbook, 'workbook')
  const sheet = requireString(o.sheet, 'sheet')
  const cyColumn = requireString(o.cyColumn, 'cyColumn')
  const pyColumn = o.pyColumn !== undefined && o.pyColumn !== null ? String(o.pyColumn) : null
  const gap = typeof o.gap === 'number' ? o.gap : undefined
  const applyToAllSheets = o.applyToAllSheets === true
  return { workbook, sheet, cyColumn, pyColumn, gap, applyToAllSheets }
}
