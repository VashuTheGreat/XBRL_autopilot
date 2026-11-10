import { describe, expect, it } from 'vitest'
import type { ProjectSummary } from '@shared/project'
import { findProjectArg, parseDotEnv, suggestedFileName, windowTitle } from '../electron/main/util/launch'

const summary = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id: 'p', path: null, fileName: null, dirty: false, taxonomy: 'ci-2016',
  company: { name: 'Acme Pvt Ltd', cin: 'U72200KA2010PTC123456' }, reportType: 'Standalone',
  cy: { start: '2025-04-01', end: '2026-03-31' }, py: { start: '2024-04-01', end: '2025-03-31' },
  firstFinancialYear: false, level: 'Lakhs', displayPlaces: 2, fyLabel: 'FY 2025-26', factCount: 0, revision: 0, sources: [],
  createdAt: '', updatedAt: '', readOnlyReason: null, ...over,
})

describe('parseDotEnv', () => {
  it('reads keys, strips quotes, ignores comments and junk', () => {
    expect(parseDotEnv('# c\nA=1\nB="two words"\nC=\'x\'\n bad line\n9X=no\nEMPTY=\r\n')).toEqual({ A: '1', B: 'two words', C: 'x', EMPTY: '' })
  })
})

describe('findProjectArg', () => {
  it('finds the double-clicked project, ignoring flags and the exe', () => {
    expect(findProjectArg(['C:\\app\\XBRL Autopilot.exe', '--flag', 'D:\\work\\Acme.AXBRL'])).toBe('D:\\work\\Acme.AXBRL')
    expect(findProjectArg(['app.exe', '.'])).toBeNull()
  })
})

describe('windowTitle', () => {
  it('shows company, FY, report type and the unsaved marker', () => {
    expect(windowTitle(null)).toBe('XBRL Autopilot')
    expect(windowTitle(summary({ dirty: true }))).toBe('Acme Pvt Ltd · FY 2025-26 · Standalone • — XBRL Autopilot')
    expect(windowTitle(summary({ readOnlyReason: 'newer' }))).toContain('(read-only)')
  })
})

describe('suggestedFileName', () => {
  it('builds a Windows-safe default file name', () => {
    expect(suggestedFileName(summary({ company: { name: 'A/B: "Co"', cin: '' } }))).toBe('AB Co_FY 2025-26_Standalone.axbrl')
  })
})
