import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fromA1, MAX_RANGE_CELLS, overlaps, rangeA1, rangeCells, rangeOf, rangeSize, toA1 } from '@shared/workbook'
import { readXlsx, UnsupportedWorkbookError } from '../electron/main/infra/xlsx-reader'
import { parseAmount, withSign } from '../electron/main/mapping/amounts'
import { cellAmount, formatPlaces, rangeAmount } from '../electron/main/mapping/cell-amount'
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

  it('rejects junk with a clear message', async () => {
    await expect(readXlsx('w', 'x.xlsx', new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(UnsupportedWorkbookError)
  })
})

describe('inferScope', () => {
  const periods = { cy: { start: '2013-04-01', end: '2014-03-31' }, py: { start: '2012-04-01', end: '2013-03-31' } }

  it('uses the column header dates of the sample balance sheet', async () => {
    const wb = await readXlsx('workbook-1.xlsx', 'sample_financials.xlsx', readFileSync(SAMPLE))
    const bs = wb.sheets[0]!
    expect(inferScope(bs, fromA1('C9')!, periods)).toEqual({ basis: 'header', scope: 'CY', reason: 'column header “31.03.2014”' })
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

  const oneColumn = (...texts: string[]) => ({
    name: 's', rowCount: texts.length + 1, colCount: 1, merges: [], colWidths: {},
    cells: [...texts.map((v, r) => ({ r, c: 0, v })), { r: texts.length, c: 0, v: 5443.47 }],
  })

  it.each([
    ['As at 30th September, 2019'], // stale header text (DGPL)
    ['31.03.2012'], // a third year (HPL prints 2026 / 2025 / 2024)
    ['FY 2011-12'],
  ])('header %s names a period outside the filing: never guessed', (header) => {
    expect(inferScope(oneColumn(header), { r: 1, c: 0 }, periods)).toEqual({ basis: 'outside', scope: null, reason: `column header “${header}”` })
  })

  it('takes the nearest period header and skips amount-like text', () => {
    expect(inferScope(oneColumn('31.03.2012', 'Current year'), { r: 2, c: 0 }, periods)?.basis).toBe('header')
    expect(inferScope(oneColumn('31.03.2014', '2,000'), { r: 2, c: 0 }, periods)?.scope).toBe('CY')
  })

  it('treats a header for the previous year as outside in a first financial year', () => {
    expect(inferScope(oneColumn('31.03.2013'), { r: 1, c: 0 }, { cy: periods.cy, py: null })?.basis).toBe('outside')
  })

  it('returns null when nothing identifies the period', () => {
    const sheet = { name: 's', rowCount: 2, colCount: 1, merges: [], colWidths: {}, cells: [{ r: 0, c: 0, v: 'Amount' }, { r: 1, c: 0, v: 5 }] }
    expect(inferScope(sheet, { r: 1, c: 0 }, periods)).toBeNull()
  })
})

describe('formatPlaces', () => {
  it.each([
    [undefined, null],
    ['General', null],
    ['@', null],
    ['dd-mm-yyyy', null],
    ['0', 0],
    ['#,##0', 0],
    ['#,##0.00', 2],
    ['#,##0.00;(#,##0.00);"-"', 2],
    ['_(* #,##0.000_);_(* (#,##0.000);_(* "-"??_);_(@_)', 3],
    ['[Red]0.0', 1],
    ['0.0%', 3],
    ['"Rs." #,##0.00', 2],
  ])('%s → %s', (fmt, places) => expect(formatPlaces(fmt)).toBe(places))
})

const st = (fallbackPlaces: number) => ({ kind: 'statement' as const, fallbackPlaces })

describe('cellAmount', () => {
  it('rounds Excel float noise to the number format (HPL 5443.466337358575 lakhs → 5443.47)', () => {
    expect(cellAmount({ v: 5443.466337358575, numFmt: '#,##0.00' }, st(0))).toEqual({
      exact: '5443.466337358575', value: '5443.47', places: 2, placesFrom: 'format', rounded: true,
    })
  })

  it('falls back to the filing’s decimal places when the cell has no number format', () => {
    expect(cellAmount({ v: 0.1 + 0.2 }, st(2))).toMatchObject({ value: '0.3', places: 2, placesFrom: 'filing', rounded: true })
    expect(cellAmount({ v: 60000000 }, st(0))).toMatchObject({ value: '60000000', rounded: false })
  })

  it('rounds half away from zero, also for negatives', () => {
    expect(cellAmount({ v: -2.5, numFmt: '0' }, st(0))?.value).toBe('-3')
    expect(cellAmount({ v: 2.5, numFmt: '0' }, st(0))?.value).toBe('3')
  })

  it('never rounds typed text and ignores non-amounts', () => {
    expect(cellAmount({ v: '(1,23,456.505)' }, st(0))).toMatchObject({ value: '-123456.505', places: 3, placesFrom: 'typed', rounded: false })
    expect(cellAmount({ v: 'Share capital' }, st(2))).toBeNull()
    expect(cellAmount({ v: null }, st(2))).toBeNull()
  })
})

describe('actual values and ranges', () => {
  const fmt = '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)'

  it('keeps share capital exact to the rupee whatever the format shows (HPL 4.1783 lakhs, float 3.9021999999999997)', () => {
    expect(cellAmount({ v: 4.1783, numFmt: fmt }, { kind: 'actual', places: 5 })).toMatchObject({ value: '4.1783', placesFrom: 'actual', rounded: false })
    expect(cellAmount({ v: 3.9021999999999997, numFmt: fmt }, { kind: 'actual', places: 5 })).toMatchObject({ value: '3.9022', rounded: true })
  })

  it('sums a range exactly, then rounds once (HPL trade payables D22:D23 → 3,494.98)', () => {
    const a = rangeAmount([{ v: 2.9794457, numFmt: fmt }, { v: 3492.0010578000006, numFmt: fmt }], st(2))
    expect(a).toMatchObject({ value: '3494.98', places: 2, placesFrom: 'format', rounded: true })
    expect(rangeAmount([{ v: '-' }, null, { v: 5, numFmt: '0' }], st(2))?.value).toBe('5')
    expect(rangeAmount([{ v: 'Note' }, null], st(2))).toBeNull()
  })

  it('handles A1 ranges', () => {
    expect(rangeOf('D23:D22')).toEqual({ r1: 21, c1: 3, r2: 22, c2: 3 })
    expect(rangeOf('C9')).toEqual({ r1: 8, c1: 2, r2: 8, c2: 2 })
    expect(rangeOf('C9:D1:E2')).toBeNull()
    expect(rangeA1({ r1: 21, c1: 3, r2: 22, c2: 3 })).toBe('D22:D23')
    expect(rangeCells('D22:E23')).toEqual(['D22', 'E22', 'D23', 'E23'])
    const at = (ref: string) => ({ workbook: 'w', sheet: 's', ref })
    expect(overlaps(at('D22:D23'), at('D23'))).toBe(true)
    expect(overlaps(at('D22:D23'), at('D24'))).toBe(false)
    expect(overlaps(at('D22'), { ...at('D22'), sheet: 't' })).toBe(false)
  })

  it('never expands a huge selection (a whole column crashed the renderer out of memory)', () => {
    expect(rangeSize('A1:XFD1048576')).toBe(16384 * 1048576)
    expect(rangeCells('A1:XFD1048576')).toEqual([])
    expect(rangeCells(`D1:D${MAX_RANGE_CELLS}`)).toHaveLength(MAX_RANGE_CELLS)
    expect(rangeCells(`D1:D${MAX_RANGE_CELLS + 1}`)).toEqual([])
  })
})
