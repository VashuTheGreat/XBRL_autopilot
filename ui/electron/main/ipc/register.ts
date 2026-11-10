/** Thin IPC controllers: validate input, delegate to services, return Results. */
import { dialog, type BrowserWindow } from 'electron'
import { IPC, type AppInfo, type HttpMethod } from '@shared/ipc'
import type { AppSettings, NewFilingInput } from '@shared/project'
import type { ProjectController } from '../project/project-controller'
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
  getWindow: () => BrowserWindow | null
}

export function registerIpc(d: IpcDeps): void {
  registerAppIpc(d)
  registerSidecarIpc(d)
  registerProjectIpc(d)
  registerSettingsIpc(d)
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

function registerProjectIpc({ projects, projectController: pc }: IpcDeps): void {
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
  handleResult(IPC.projectElrs, () => projects.elrs())
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
