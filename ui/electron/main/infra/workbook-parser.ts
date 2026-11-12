/**
 * The WorkbookParser the app uses: .xlsx/.xlsm through exceljs (in process, keeps number formats and fonts), old .xls
 * (BIFF, e.g. DGPL) through the sidecar's python-calamine route. Dispatches on the file's signature, not its name:
 * a renamed file still lands on the right reader.
 */
import type { SheetModel, WorkbookModel } from '@shared/workbook'
import type { SidecarClient } from '../services/ports'
import type { WorkbookParser } from '../services/source-service'
import { sidecarCall } from './sidecar-call'
import { UnsupportedWorkbookError } from './xlsx-reader'

const OLE2 = [0xd0, 0xcf, 0x11, 0xe0] // compound file: .xls
const ZIP = [0x50, 0x4b] // "PK": .xlsx / .xlsm

const startsWith = (bytes: Uint8Array, sig: number[]) => sig.every((b, i) => bytes[i] === b)

export type WorkbookFormat = 'xlsx' | 'xls'

export function workbookFormat(fileName: string, bytes: Uint8Array): WorkbookFormat {
  if (startsWith(bytes, OLE2)) return 'xls'
  if (startsWith(bytes, ZIP)) return 'xlsx'
  return /\.xls$/i.test(fileName) ? 'xls' : 'xlsx'
}

/** .xls via the sidecar (stateless: the bytes go to 127.0.0.1 only, never to an AI service). */
export function sidecarXlsReader(sidecar: SidecarClient): WorkbookParser {
  return async (source, fileName, bytes) => {
    let model: Pick<WorkbookModel, 'sheets'>
    try {
      model = await sidecarCall(sidecar, 'POST', '/api/v1/workbooks/read', {
        body: { fileName, contentBase64: Buffer.from(bytes).toString('base64') },
        what: 'Workbook reader',
      })
    } catch (err) {
      throw new UnsupportedWorkbookError(err instanceof Error ? err.message : String(err))
    }
    return { source, fileName, sheets: model.sheets }
  }
}

/**
 * Cells kept per sheet. Statements and notes have a few thousand; HPL's "payables- mar 26" ledger dump has 1.3 million,
 * which would freeze the grid and the IPC channel. Such a sheet keeps its first rows and says so.
 */
export const MAX_CELLS_PER_SHEET = 60_000

export function capSheet(sheet: SheetModel, max = MAX_CELLS_PER_SHEET): SheetModel {
  if (sheet.cells.length <= max) return sheet
  const cells = [...sheet.cells].sort((a, b) => a.r - b.r || a.c - b.c)
  // whole rows only: cut before the row that would cross the limit
  const lastRow = cells[max]!.r - 1
  const kept = cells.filter((c) => c.r <= lastRow)
  return {
    ...sheet,
    cells: kept,
    rowCount: lastRow + 1,
    merges: sheet.merges.filter((m) => m.r2 <= lastRow),
    truncated: { totalCells: sheet.cells.length, keptRows: lastRow + 1 },
  }
}

/** Capping applied to workbooks sent to the grid / UI renderer only (ADR-0013 step 6). */
export function capWorkbook(model: WorkbookModel, max = MAX_CELLS_PER_SHEET): WorkbookModel {
  return { ...model, sheets: model.sheets.map((s) => capSheet(s, max)) }
}

export function workbookParser(readers: Record<WorkbookFormat, WorkbookParser>): WorkbookParser {
  return async (source, fileName, bytes) => {
    return readers[workbookFormat(fileName, bytes)](source, fileName, bytes)
  }
}
