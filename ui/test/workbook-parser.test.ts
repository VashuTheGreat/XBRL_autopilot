import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { capSheet, capWorkbook, sidecarXlsReader, workbookFormat, workbookParser } from '../electron/main/infra/workbook-parser'
import { readXlsx, UnsupportedWorkbookError } from '../electron/main/infra/xlsx-reader'
import type { SidecarClient } from '../electron/main/services/ports'
import { SidecarManager } from '../electron/main/sidecar'

const REPO = resolve(__dirname, '../..')
const DGPL = resolve(REPO, 'data/BS DGPL Mar-2026-V1.xls')
const SAMPLE = resolve(REPO, 'data/sample_financials.xlsx')

describe('workbookFormat', () => {
  it('goes by the file signature, then the name', () => {
    expect(workbookFormat('a.xlsx', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0]))).toBe('xls')
    expect(workbookFormat('a.xls', new Uint8Array([0x50, 0x4b, 3, 4]))).toBe('xlsx')
    expect(workbookFormat('a.xls', new Uint8Array([1]))).toBe('xls')
    expect(workbookFormat('a.xlsm', new Uint8Array([1]))).toBe('xlsx')
  })

  it('surfaces a sidecar refusal as an UnsupportedWorkbookError', async () => {
    const refusing: SidecarClient = {
      whenReady: async () => {},
      request: async <T,>() => ({ status: 422, data: { success: false, message: 'x.xls: The file could not be read as an Excel workbook.' } as T }),
    }
    await expect(sidecarXlsReader(refusing)('workbook-1.xls', 'x.xls', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).rejects.toBeInstanceOf(UnsupportedWorkbookError)
  })
})

describe('capSheet and capWorkbook', () => {
  it('keeps whole first rows of an oversized sheet and says so', () => {
    const cells = Array.from({ length: 30 }, (_, i) => ({ r: Math.floor(i / 3), c: i % 3, v: i }))
    const sheet = { name: 'ledger', rowCount: 10, colCount: 3, cells, merges: [{ r1: 0, c1: 0, r2: 0, c2: 1 }, { r1: 8, c1: 0, r2: 9, c2: 0 }], colWidths: {} }
    const cut = capSheet(sheet, 10)
    expect(cut.cells).toHaveLength(9) // rows 0-2; row 3 would cross the limit
    expect(cut).toMatchObject({ rowCount: 3, truncated: { totalCells: 30, keptRows: 3 } })
    expect(cut.merges).toEqual([{ r1: 0, c1: 0, r2: 0, c2: 1 }])
    expect(capSheet(sheet, 30)).toBe(sheet)
  })

  it('capWorkbook caps every sheet in a workbook model for the grid', () => {
    const cells = Array.from({ length: 30 }, (_, i) => ({ r: Math.floor(i / 3), c: i % 3, v: i }))
    const wb = {
      source: 'src.xlsx',
      fileName: 'src.xlsx',
      sheets: [
        { name: 's1', rowCount: 10, colCount: 3, cells, merges: [], colWidths: {} },
        { name: 's2', rowCount: 2, colCount: 2, cells: [{ r: 0, c: 0, v: 1 }], merges: [], colWidths: {} },
      ],
    }
    const capped = capWorkbook(wb, 10)
    expect(capped.sheets[0]!.cells).toHaveLength(9)
    expect(capped.sheets[0]!.truncated?.totalCells).toBe(30)
    expect(capped.sheets[1]!.cells).toHaveLength(1)
  })
})

// The real FastAPI sidecar reads the DGPL .xls (python-calamine).
describe.skipIf(!existsSync(DGPL))('workbookParser with the real sidecar', () => {
  let sidecar: SidecarManager
  beforeAll(async () => {
    sidecar = new SidecarManager({ isPackaged: false, repoRoot: REPO, resourcesPath: '' })
    void sidecar.start()
    await sidecar.whenReady(170_000)
  }, 180_000)
  afterAll(async () => {
    await sidecar?.stop()
  })

  it('reads .xls through the sidecar and .xlsx in process', async () => {
    const parse = workbookParser({ xlsx: readXlsx, xls: sidecarXlsReader(sidecar) })
    const dgpl = await parse('workbook-1.xls', 'BS DGPL Mar-2026-V1.xls', readFileSync(DGPL))
    expect(dgpl).toMatchObject({ source: 'workbook-1.xls', fileName: 'BS DGPL Mar-2026-V1.xls' })
    expect(dgpl.sheets[0]!.name).toBe('IND AS BS ')
    expect(dgpl.sheets[0]!.cells.find((c) => c.r === 0 && c.c === 1)?.v).toBe('DIXON GLOBAL PRIVATE LIMITED')
    const sample = await parse('workbook-2.xlsx', 'sample_financials.xlsx', readFileSync(SAMPLE))
    expect(sample.sheets.map((s) => s.name)).toEqual(['BS', 'PL', 'BS Sch'])
  }, 60_000)
})
