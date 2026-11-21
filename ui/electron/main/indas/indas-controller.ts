/**
 * IndasController: the Electron adapter around IndasPipelineService (docs/17). It adds the file dialogs,
 * progress events and "show in folder". All pipeline rules stay in the service (tested without Electron).
 */
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { dialog, shell, type BrowserWindow } from 'electron'
import type { ConceptSuggestion, GenerateXmlInput, GenerateXmlResult, MasterFields, TransformResult } from '@shared/indas'
import type { IndasPipelineService } from '../services/indas-pipeline-service'

export const TEMPLATE_FILE_NAME = 'XBRL_Autopilot_Standard_Template.xlsx'
const EXCEL_FILTERS = [{ name: 'Excel workbook', extensions: ['xlsx', 'xls'] }]

export class IndasController {
  private lastGenerated: string | null = null

  constructor(
    private readonly service: IndasPipelineService,
    private readonly getWindow: () => BrowserWindow | null,
    private readonly projectsDir: () => string,
    private readonly onProgress: (done: number, total: number) => void,
  ) {}

  /** Asks where to save the standard template and writes it. `null` = cancelled. */
  async saveTemplate(): Promise<string | null> {
    const opts = { title: 'Save standard template', defaultPath: join(this.projectsDir(), TEMPLATE_FILE_NAME), filters: [EXCEL_FILTERS[0]] }
    const win = this.getWindow()
    const { canceled, filePath } = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (canceled || !filePath) return null
    await writeFile(filePath, await this.service.template())
    return filePath
  }

  /** Asks for the financial statements workbook and converts it. `null` = cancelled. */
  async transform(): Promise<TransformResult | null> {
    const opts = { title: 'Open financial statements', properties: ['openFile' as const], filters: EXCEL_FILTERS, defaultPath: this.projectsDir() }
    const win = this.getWindow()
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const file = canceled ? undefined : filePaths[0]
    if (!file) return null
    return this.service.transform(basename(file), new Uint8Array(await readFile(file)))
  }

  recommend(keys: string[]): Promise<ConceptSuggestion[][]> {
    return this.service.recommend(keys, 3, this.onProgress)
  }

  masterFields(): Promise<MasterFields> {
    return this.service.masterFields()
  }

  async generate(input: GenerateXmlInput): Promise<GenerateXmlResult> {
    const r = await this.service.generate(input)
    if (r.ok) this.lastGenerated = r.path
    return r
  }

  /** Opens the folder of the last generated XML with the file selected. */
  showGenerated(): void {
    if (this.lastGenerated) shell.showItemInFolder(this.lastGenerated)
  }
}
