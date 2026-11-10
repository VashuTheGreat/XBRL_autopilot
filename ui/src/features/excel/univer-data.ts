/** WorkbookModel → Univer IWorkbookData (pure; type-only Univer import, so it is unit-testable). */
import type { ICellData, IWorkbookData, IWorksheetData } from '@univerjs/presets'
import type { WorkbookModel } from '@shared/workbook'

export const sheetId = (i: number) => `s${i}`

/** Excel column width (characters) → pixels, as Excel renders Calibri 11. */
const widthPx = (chars: number) => Math.round(chars * 7 + 5)

export function toUniverWorkbook(model: WorkbookModel): Partial<IWorkbookData> {
  const sheets: Record<string, Partial<IWorksheetData>> = {}
  model.sheets.forEach((sh, i) => {
    const cellData: Record<number, Record<number, ICellData>> = {}
    for (const c of sh.cells) {
      if (c.v === null) continue
      const t = typeof c.v === 'number' ? 2 : typeof c.v === 'boolean' ? 3 : 1
      const style = c.bold && c.italic ? 'bi' : c.bold ? 'b' : c.italic ? 'i' : undefined
      ;(cellData[c.r] ??= {})[c.c] = { v: c.v, t: t as ICellData['t'], ...(style ? { s: style } : {}) }
    }
    const columnData: Record<number, { w: number }> = {}
    for (const [c, w] of Object.entries(sh.colWidths)) columnData[Number(c)] = { w: widthPx(w) }
    sheets[sheetId(i)] = {
      id: sheetId(i),
      name: sh.name,
      rowCount: Math.max(sh.rowCount + 30, 100),
      columnCount: Math.max(sh.colCount + 6, 20),
      cellData,
      columnData,
      mergeData: sh.merges.map((m) => ({ startRow: m.r1, endRow: m.r2, startColumn: m.c1, endColumn: m.c2 })),
      defaultColumnWidth: 88,
    }
  })
  return {
    id: model.source,
    name: model.fileName,
    sheetOrder: model.sheets.map((_, i) => sheetId(i)),
    styles: { b: { bl: 1 }, i: { it: 1 }, bi: { bl: 1, it: 1 } },
    sheets: sheets as IWorkbookData['sheets'],
  }
}
