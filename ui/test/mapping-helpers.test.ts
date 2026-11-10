import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fromA1, toA1 } from '@shared/workbook'
import { readXlsx, UnsupportedWorkbookError } from '../electron/main/infra/xlsx-reader'
import { parseAmount, withSign } from '../electron/main/mapping/amounts'
import { inferScope } from '../electron/main/mapping/scope-inference'

const SAMPLE = resolve(__dirname, '../../data/sample_financials.xlsx')

describe('A1 helpers', () => {
  it('round-trips references', () => {
    for (const [r, c, a1] of [[0, 0, 'A1'], [8, 2, 'C9'], [0, 25, 'Z1'], [0, 26, 'AA1'], [99, 701, 'ZZ100']] as const) {
      expect(toA1(r, c)).toBe(a1)
      expect(fromA1(a1)).toEqual({ r, c })
    }
    expect(fromA1('A0')).toBeNull()
    expect(fromA1('C9:D10')).toBeNull()
  })
})

describe('parseAmount', () => {
  it.each([
    [60000000, '60000000'],
    [-343854, '-343854'],
    [0.1, '0.1'],
    [1234.5, '1234.5'],
    [1e21, '1000000000000000000000'],
    ['(1,23,456.50)', '-123456.50'],
    ['Rs. 1,000', '1000'],
    ['₹ 2,500', '2500'],
    ['  -42 ', '-42'],
    ['1,000 Dr', '1000'],
    ['007', '7'],
    ['-', null],
    ['Nil', null],
    ['', null],
    ['abc', null],
    [null, null],
    [true, null],
  ])('%s → %s', (input, out) => expect(parseAmount(input as never)).toBe(out))

  it('applies a sign without touching zero', () => {
    expect(withSign('100', -1)).toBe('-100')
    expect(withSign('-100', -1)).toBe('100')
    expect(withSign('0', -1)).toBe('0')
  })
})

describe('readXlsx on data/sample_financials.xlsx', () => {
  it('keeps every non-empty cell with its position', async () => {
    const wb = await readXlsx('workbook-1.xlsx', 'sample_financials.xlsx', readFileSync(SAMPLE))
    expect(wb.sheets.map((s) => s.name)).toEqual(['BS', 'PL', 'BS Sch'])
    const bs = wb.sheets[0]!
    const at = (a1: string) => bs.cells.find((c) => toA1(c.r, c.c) === a1)?.v
    expect(at('A9')).toBe('- Share Capital')
    expect(at('C9')).toBe(60000000)
    expect(at('C10')).toBe(-343854)
    expect(at('D10')).toBe(-322114)
    expect(at('C5')).toBe('31.03.2014')
    expect(wb.sheets[2]!.cells.some((c) => c.r === 69)).toBe(true) // BS Sch starts at row 70
  })

  it('rejects .xls and junk with a clear message', async () => {
    await expect(readXlsx('w', 'old.xls', new Uint8Array([1]))).rejects.toThrow(/save it as .xlsx/)
    await expect(readXlsx('w', 'x.xlsx', new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(UnsupportedWorkbookError)
  })
})

describe('inferScope', () => {
  const periods = { cy: { start: '2013-04-01', end: '2014-03-31' }, py: { start: '2012-04-01', end: '2013-03-31' } }

  it('uses the column header dates of the sample balance sheet', async () => {
    const wb = await readXlsx('workbook-1.xlsx', 'sample_financials.xlsx', readFileSync(SAMPLE))
    const bs = wb.sheets[0]!
    expect(inferScope(bs, fromA1('C9')!, periods)).toEqual({ scope: 'CY', reason: 'column header “31.03.2014”' })
    expect(inferScope(bs, fromA1('D9')!, periods)?.scope).toBe('PY')
  })

  it('falls back to the two value columns when there is no header (BS Sch)', async () => {
    const wb = await readXlsx('workbook-1.xlsx', 'sample_financials.xlsx', readFileSync(SAMPLE))
    const sch = wb.sheets[2]!
    expect(inferScope(sch, fromA1('C81')!, periods)?.scope).toBe('CY')
    expect(inferScope(sch, fromA1('D81')!, periods)?.scope).toBe('PY')
  })

  it.each([
    ['As at 31st March, 2014', 'CY'],
    ['March 31, 2013', 'PY'],
    ['FY 2013-14', 'CY'],
    ['2012-13', 'PY'],
    ['Current Year', 'CY'],
    ['Previous year', 'PY'],
    ['2014-03-31', 'CY'],
  ])('header %s → %s', (header, scope) => {
    const sheet = { name: 's', rowCount: 3, colCount: 1, merges: [], colWidths: {}, cells: [{ r: 0, c: 0, v: header }, { r: 2, c: 0, v: 5 }] }
    expect(inferScope(sheet, { r: 2, c: 0 }, periods)?.scope).toBe(scope)
  })

  it('returns null when nothing identifies the period', () => {
    const sheet = { name: 's', rowCount: 2, colCount: 1, merges: [], colWidths: {}, cells: [{ r: 0, c: 0, v: 'Amount' }, { r: 1, c: 0, v: 5 }] }
    expect(inferScope(sheet, { r: 1, c: 0 }, periods)).toBeNull()
  })
})
