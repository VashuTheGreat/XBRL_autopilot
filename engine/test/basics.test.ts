import { describe, expect, it } from 'vitest'
import { defaultStatementPlaces, fyLabel, maxDisplayPlaces, previousYearOf, ROUNDING_LEVELS, validateFilingPeriods } from '../src/basics'

describe('period helpers', () => {
  it('derives the previous year from an April–March current year', () => {
    expect(previousYearOf({ start: '2025-04-01', end: '2026-03-31' })).toEqual({ start: '2024-04-01', end: '2025-03-31' })
  })
  it('handles a calendar year and rejects bad input', () => {
    expect(previousYearOf({ start: '2025-01-01', end: '2025-12-31' })).toEqual({ start: '2024-01-01', end: '2024-12-31' })
    expect(previousYearOf({ start: '2025-13-01', end: '2026-03-31' })).toBeNull()
    expect(previousYearOf({ start: '2026-04-01', end: '2025-03-31' })).toBeNull()
  })
  it('labels financial years', () => {
    expect(fyLabel({ start: '2025-04-01', end: '2026-03-31' })).toBe('FY 2025-26')
    expect(fyLabel({ start: '2025-01-01', end: '2025-12-31' })).toBe('FY 2025')
  })
  it('validates periods like the engine', () => {
    expect(validateFilingPeriods({ start: '2025-04-01', end: '2026-03-31' }, { start: '2024-04-01', end: '2025-03-31' })).toEqual([])
    expect(validateFilingPeriods({ start: '2025-04-01', end: '2026-03-31' }, null)).toEqual([])
    expect(validateFilingPeriods({ start: '2025-04-01', end: '2026-03-31' }, { start: '2024-04-01', end: '2025-04-01' })).toEqual([
      'Previous year must end before the current year starts',
    ])
    expect(validateFilingPeriods({ start: '2025-02-30', end: '2026-03-31' }, null)[0]).toMatch(/valid dates/)
  })
})

describe('defaultReportingYear', () => {
  it('picks the last completed April–March year', async () => {
    const { defaultReportingYear } = await import('../src/basics')
    expect(defaultReportingYear(new Date(2026, 10, 10))).toEqual({ start: '2025-04-01', end: '2026-03-31' })
    expect(defaultReportingYear(new Date(2026, 3, 1))).toEqual({ start: '2025-04-01', end: '2026-03-31' })
    expect(defaultReportingYear(new Date(2026, 2, 31))).toEqual({ start: '2024-04-01', end: '2025-03-31' })
  })
})

describe('formatIndian', () => {
  it('groups like an Indian balance sheet', async () => {
    const { formatIndian } = await import('../src/basics')
    expect(formatIndian('60000000')).toBe('6,00,00,000')
    expect(formatIndian('-343854.50')).toBe('-3,43,854.50')
    expect(formatIndian('999')).toBe('999')
    expect(formatIndian('1000')).toBe('1,000')
    expect(formatIndian('Lakhs')).toBe('Lakhs')
  })
})

describe('display places', () => {
  it('reach paise at every level, in step with the engine scale powers', async () => {
    const { SCALE_POWERS } = await import('../src/core/scaling.js')
    for (const level of ROUNDING_LEVELS) expect(maxDisplayPlaces(level)).toBe((SCALE_POWERS as Record<string, number>)[level]! + 2)
    expect(defaultStatementPlaces('Actual')).toBe(0)
    expect(defaultStatementPlaces('Lakhs')).toBe(2)
  })
})

describe('numbersInText', () => {
  it('lists the figures of a text cell, dates removed (the fixture shared with the sidecar)', async () => {
    const { readFileSync } = await import('node:fs')
    const { numbersInText } = await import('../src/basics')
    const { cases } = JSON.parse(readFileSync(new URL('../../tests/fixtures/numbers_in_text.json', import.meta.url), 'utf8')) as { cases: [string, string[]][] }
    for (const [text, want] of cases) expect(numbersInText(text), text).toEqual(want)
  })
})

describe('parseCellDate', () => {
  it('parses ISO dates and dates with timestamps', async () => {
    const { parseCellDate } = await import('../src/basics')
    expect(parseCellDate('2026-03-31')).toBe('2026-03-31')
    expect(parseCellDate('2025-04-01T00:00:00.000Z')).toBe('2025-04-01')
    expect(parseCellDate('2025-04-01 12:30:00')).toBe('2025-04-01')
  })

  it('parses DMY strings with various separators and 2/4 digit years', async () => {
    const { parseCellDate } = await import('../src/basics')
    expect(parseCellDate('31/03/2026')).toBe('2026-03-31')
    expect(parseCellDate('31-03-2026')).toBe('2026-03-31')
    expect(parseCellDate('31.03.2026')).toBe('2026-03-31')
    expect(parseCellDate('31/03/26')).toBe('2026-03-31')
    expect(parseCellDate('1/4/2025')).toBe('2025-04-01')
  })

  it('parses text dates with month names', async () => {
    const { parseCellDate } = await import('../src/basics')
    expect(parseCellDate('31st March 2026')).toBe('2026-03-31')
    expect(parseCellDate('31 March, 2026')).toBe('2026-03-31')
    expect(parseCellDate('31-Mar-2026')).toBe('2026-03-31')
    expect(parseCellDate('31-Mar-26')).toBe('2026-03-31')
    expect(parseCellDate('March 31, 2026')).toBe('2026-03-31')
  })

  it('parses Excel serial dates in numeric and string form', async () => {
    const { parseCellDate } = await import('../src/basics')
    expect(parseCellDate(46112)).toBe('2026-03-31')
    expect(parseCellDate(45747)).toBe('2025-03-31')
    expect(parseCellDate('45747')).toBe('2025-03-31')
  })

  it('returns null on invalid or non-date values', async () => {
    const { parseCellDate } = await import('../src/basics')
    expect(parseCellDate(null)).toBeNull()
    expect(parseCellDate('')).toBeNull()
    expect(parseCellDate('not a date')).toBeNull()
    expect(parseCellDate('31/02/2026')).toBeNull() // invalid day for Feb
    expect(parseCellDate(500.5)).toBeNull() // not a serial date
  })
})
