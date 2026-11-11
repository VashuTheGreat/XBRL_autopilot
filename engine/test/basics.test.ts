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
