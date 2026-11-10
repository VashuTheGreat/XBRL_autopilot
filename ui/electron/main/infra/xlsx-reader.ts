/**
 * Reads an .xlsx into the WorkbookModel the Excel pane renders. Every non-empty cell is kept with its position,
 * so layout heuristics (and the AI in Phase 5) see the sheet as the accountant laid it out.
 * .xls (BIFF) is not supported by exceljs; users get a clear message to re-save as .xlsx.
 */
import ExcelJS from 'exceljs'
import type { CellModel, CellValue, SheetModel, WorkbookModel } from '@shared/workbook'
import { fromA1 } from '@shared/workbook'

export class UnsupportedWorkbookError extends Error {}

const isoDate = (d: Date) => d.toISOString().slice(0, 10)

/** Normalises the many exceljs value shapes to a plain value + optional formula. */
function plainValue(v: ExcelJS.CellValue): { v: CellValue; f?: string } {
  if (v == null) return { v: null }
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return { v }
  if (v instanceof Date) return { v: isoDate(v) }
  if (typeof v === 'object') {
    if ('richText' in v) return { v: v.richText.map((t) => t.text).join('') }
    if ('formula' in v || 'sharedFormula' in v) {
      const res = (v as { result?: ExcelJS.CellValue }).result
      const formula = 'formula' in v ? v.formula : undefined
      const inner = res instanceof Date ? isoDate(res) : typeof res === 'object' && res !== null ? null : (res ?? null)
      return { v: inner as CellValue, ...(formula ? { f: formula } : {}) }
    }
    if ('text' in v && 'hyperlink' in v) return { v: String(v.text) }
    if ('error' in v) return { v: String(v.error) }
  }
  return { v: String(v) }
}

function parseMerge(range: string): SheetModel['merges'][number] | null {
  const [a, b] = range.split(':')
  const p = a ? fromA1(a.replace(/\$/g, '')) : null
  const q = b ? fromA1(b.replace(/\$/g, '')) : null
  return p && q ? { r1: p.r, c1: p.c, r2: q.r, c2: q.c } : null
}

export async function readXlsx(source: string, fileName: string, bytes: Uint8Array): Promise<WorkbookModel> {
  if (/\.xls$/i.test(fileName)) {
    throw new UnsupportedWorkbookError('Old .xls workbooks are not supported yet. Open it in Excel and save it as .xlsx, then import again.')
  }
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.load(bytes as unknown as ArrayBuffer)
  } catch {
    throw new UnsupportedWorkbookError(`${fileName} could not be read as an Excel workbook (.xlsx).`)
  }
  const sheets: SheetModel[] = []
  wb.eachSheet((ws) => {
    if (ws.state && ws.state !== 'visible') return // hidden sheets are working papers, not statements
    const cells: CellModel[] = []
    let maxR = 0
    let maxC = 0
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const { v, f } = plainValue(cell.value)
        if (v === null && !f) return
        if (typeof v === 'string' && !v.trim() && !f) return
        const r = Number(cell.row) - 1
        const c = Number(cell.col) - 1
        const model: CellModel = { r, c, v }
        if (f) model.f = f
        if (cell.font?.bold) model.bold = true
        if (cell.font?.italic) model.italic = true
        if (cell.alignment?.indent) model.indent = cell.alignment.indent
        if (cell.numFmt && cell.numFmt !== 'General') model.numFmt = cell.numFmt
        cells.push(model)
        maxR = Math.max(maxR, r)
        maxC = Math.max(maxC, c)
      })
    })
    const colWidths: Record<number, number> = {}
    for (let c = 1; c <= Math.max(ws.columnCount, maxC + 1); c++) {
      const w = ws.getColumn(c).width
      if (w) colWidths[c - 1] = w
    }
    const merges = ((ws.model as { merges?: string[] }).merges ?? []).map(parseMerge).filter((m): m is NonNullable<typeof m> => m !== null)
    sheets.push({ name: ws.name, rowCount: Math.max(maxR + 1, 1), colCount: Math.max(maxC + 1, 1), cells, merges, colWidths })
  })
  if (!sheets.length) throw new UnsupportedWorkbookError(`${fileName} has no visible worksheets.`)
  return { source, fileName, sheets }
}
