/**
 * SourceService: the Excel workbooks imported into the open filing (stored byte-identical in the .axbrl).
 * Parsing is cached per project+source; the parser is injected (the xlsx adapter in production).
 */
import type { CellModel, CellRef, SheetModel, WorkbookModel } from '@shared/workbook'
import { MAX_RANGE_CELLS, rangeCells, rangeOf, rangeSize } from '@shared/workbook'
import { ValidationError } from './errors'
import type { ProjectAccess } from './ports'

export type WorkbookParser = (source: string, fileName: string, bytes: Uint8Array) => Promise<WorkbookModel>

export class SourceService {
  private readonly cache = new Map<string, Promise<WorkbookModel>>()

  constructor(
    private readonly projects: ProjectAccess,
    private readonly parse: WorkbookParser,
  ) {}

  /** Parses first (so a bad file never enters the project), then stores the bytes. */
  async importWorkbook(fileName: string, bytes: Uint8Array): Promise<WorkbookModel> {
    const p = this.projects.project()
    const n = Object.keys(p.content.sources).length + 1
    // keep the real extension: the .axbrl stores the bytes unchanged, and an .xls is not an .xlsx
    const source = `workbook-${n}.${/\.xls$/i.test(fileName) ? 'xls' : 'xlsx'}`
    let model: WorkbookModel
    try {
      model = await this.parse(source, fileName, bytes)
    } catch (err) {
      throw new ValidationError([err instanceof Error ? err.message : String(err)])
    }
    p.content.sources[source] = bytes
    p.content.manifest.sources = { ...p.content.manifest.sources, [source]: { fileName, importedAt: new Date().toISOString() } }
    this.cache.set(`${p.id}|${source}`, Promise.resolve(model))
    p.touch()
    return model
  }

  async workbooks(): Promise<WorkbookModel[]> {
    const p = this.projects.project()
    return Promise.all(Object.keys(p.content.sources).map((s) => this.workbook(s)))
  }

  async workbook(source: string): Promise<WorkbookModel> {
    const p = this.projects.project()
    const bytes = p.content.sources[source]
    if (!bytes) throw new ValidationError([`Workbook ${source} is not part of this filing.`])
    const key = `${p.id}|${source}`
    let cached = this.cache.get(key)
    if (!cached) {
      const name = p.content.manifest.sources?.[source]?.fileName ?? source
      cached = this.parse(source, name, bytes)
      this.cache.set(key, cached)
      cached.catch(() => this.cache.delete(key))
    }
    return cached
  }

  async sheet(ref: Pick<CellRef, 'workbook' | 'sheet'>): Promise<SheetModel> {
    const sheet = (await this.workbook(ref.workbook)).sheets.find((s) => s.name === ref.sheet)
    if (!sheet) throw new ValidationError([`Sheet "${ref.sheet}" was not found in the workbook.`])
    return sheet
  }

  /** A cell, or a range's top-left cell (its anchor), plus every cell of the reference (null where empty). */
  async cell(ref: CellRef): Promise<{ sheet: SheetModel; at: { r: number; c: number }; cell: CellModel | null; cells: (CellModel | null)[] }> {
    const g = rangeOf(ref.ref)
    if (!g) throw new ValidationError([`"${ref.ref}" is not a cell reference.`])
    if (rangeSize(ref.ref) > MAX_RANGE_CELLS) throw new ValidationError([`Select at most ${MAX_RANGE_CELLS} cells to tag their sum.`])
    const sheet = await this.sheet(ref)
    const find = (r: number, c: number) => sheet.cells.find((x) => x.r === r && x.c === c) ?? null
    const cells = rangeCells(ref.ref).map((a1) => {
      const q = rangeOf(a1)!
      return find(q.r1, q.c1)
    })
    return { sheet, at: { r: g.r1, c: g.c1 }, cell: cells[0] ?? null, cells }
  }

  /** The row's label: the leftmost text cell left of `ref` (the "Particulars" column). */
  async rowLabel(ref: CellRef): Promise<string | null> {
    const { sheet, at } = await this.cell(ref)
    const label = sheet.cells
      .filter((c) => c.r === at.r && c.c < at.c && typeof c.v === 'string' && c.v.trim())
      .sort((a, b) => a.c - b.c)[0]
    return label ? String(label.v).trim() : null
  }
}
