/**
 * ProjectController: the Electron adapter around ProjectService. It adds file dialogs and the
 * "save changes?" prompt. All project rules stay in ProjectService (tested without Electron).
 */
import { dialog, type BrowserWindow } from 'electron'
import type { NewFilingInput, ProjectSummary } from '@shared/project'
import { NoSavePathError } from '../services/errors'
import type { ProjectService } from '../services/project-service'
import { suggestedFileName } from '../util/launch'
import { AXBRL_EXTENSION } from './axbrl'

const FILTERS = [{ name: 'XBRL Autopilot project', extensions: [AXBRL_EXTENSION.slice(1)] }]

export class ProjectController {
  constructor(
    private readonly service: ProjectService,
    private readonly getWindow: () => BrowserWindow | null,
  ) {}

  async create(input: NewFilingInput): Promise<ProjectSummary | null> {
    if (!(await this.confirmUnsaved())) return null
    return this.service.newFiling(input)
  }

  async open(path?: string): Promise<ProjectSummary | null> {
    if (!(await this.confirmUnsaved())) return null
    const file = path ?? (await this.pickOpenPath())
    return file ? this.service.open(file) : null
  }

  async recover(id: string): Promise<ProjectSummary | null> {
    if (!(await this.confirmUnsaved())) return null
    return this.service.recover(id)
  }

  /** Save; asks for a location the first time. `null` = cancelled. */
  async save(): Promise<ProjectSummary | null> {
    try {
      return await this.service.save()
    } catch (err) {
      if (err instanceof NoSavePathError) return this.saveAs()
      throw err
    }
  }

  async saveAs(): Promise<ProjectSummary | null> {
    const s = this.service.summary()
    if (!s) return null
    const win = this.getWindow()
    const opts = { title: 'Save filing', defaultPath: s.path ?? suggestedFileName(s), filters: FILTERS }
    const { canceled, filePath } = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    return canceled || !filePath ? null : this.service.saveAs(filePath)
  }

  /** `false` when the user cancelled. */
  async close(): Promise<boolean> {
    if (!(await this.confirmUnsaved())) return false
    await this.service.close()
    return true
  }

  /**
   * If there are unsaved changes, asks Save / Don't save / Cancel.
   * @returns true when it's fine to continue (saved, discarded, or nothing to save)
   */
  async confirmUnsaved(): Promise<boolean> {
    const s = this.service.summary()
    if (!s?.dirty || s.readOnlyReason) return true
    const opts = {
      type: 'warning' as const,
      buttons: ['Save', "Don't save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      title: 'Unsaved changes',
      message: `Save changes to ${s.company.name || 'this filing'} (${s.fyLabel})?`,
      detail: "Your changes will be lost if you don't save them.",
    }
    const win = this.getWindow()
    const { response } = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
    if (response === 2) return false
    if (response === 0) return (await this.save()) !== null
    return true
  }

  private async pickOpenPath(): Promise<string | null> {
    const win = this.getWindow()
    const opts = { title: 'Open filing', properties: ['openFile' as const], filters: FILTERS }
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return canceled ? null : (filePaths[0] ?? null)
  }
}
