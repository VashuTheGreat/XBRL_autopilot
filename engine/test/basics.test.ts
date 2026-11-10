import { describe, expect, it } from 'vitest'
import { fyLabel, previousYearOf, validateFilingPeriods } from '../src/basics'

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
