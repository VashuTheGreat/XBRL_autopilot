import { describe, expect, it } from 'vitest'
import type { MasterField, TransformResult } from '@shared/indas'
import {
  acceptTopSuggestions,
  amount,
  buildGenerateInput,
  fieldKind,
  prefillMasters,
  readinessProblems,
  rowsFromTransform,
  suggestionKey,
  type TagRow,
} from '../src/features/indas/model'

const transform: TransformResult = {
  fileName: 'fs.xlsx',
  source: 'heuristic',
  summary: {},
  sheets: {
    CANONICAL_BS: [
      { Row_Index: 1, Line_Item: 'Share capital', Breadcrumb_Hierarchy: 'EQUITY AND LIABILITIES > Equity > Share capital', Note_No: 3.0, Current_Year_Amount: 417830, Previous_Year_Amount: 390220 },
      { Row_Index: 2, Line_Item: 'Non-current assets', Breadcrumb_Hierarchy: 'Assets', Note_No: null, Current_Year_Amount: null, Previous_Year_Amount: null },
      { Row_Index: 3, Line_Item: 'Inventories', Breadcrumb_Hierarchy: '', Note_No: null, Current_Year_Amount: '1,200.50', Previous_Year_Amount: '-' },
    ],
    CANONICAL_PL: [{ Row_Index: 1, Line_Item: 'Revenue from operations', Breadcrumb_Hierarchy: 'Income', Note_No: '18', Current_Year_Amount: 9000000, Previous_Year_Amount: null }],
  },
}

const field = (qname: string, type = 'stringItemType'): MasterField => ({ qname, label: qname.split(':')[1], type })

describe('amount', () => {
  it('passes numbers through and reads numeric text; blanks and dashes are null', () => {
    expect(amount(417830)).toBe(417830)
    expect(amount('1,200.50')).toBe(1200.5)
    expect(amount('-')).toBeNull()
    expect(amount('')).toBeNull()
    expect(amount('n/a')).toBeNull()
    expect(amount(null)).toBeNull()
  })
})

describe('rowsFromTransform', () => {
  it('keeps the BS and PL lines that carry an amount, in sheet order', () => {
    const rows = rowsFromTransform(transform)
    expect(rows.map((r) => [r.id, r.label, r.note, r.cy, r.py])).toEqual([
      ['balanceSheet:0', 'Share capital', '3', 417830, 390220],
      ['balanceSheet:2', 'Inventories', '', 1200.5, null],
      ['profitLoss:0', 'Revenue from operations', '18', 9000000, null],
    ])
    expect(rows.every((r) => r.concept === '' && r.suggestions.length === 0)).toBe(true)
  })
})

describe('suggestionKey', () => {
  it('searches with the breadcrumb when there is one', () => {
    expect(suggestionKey({ label: 'Share capital', breadcrumb: 'Equity > Share capital' })).toBe('Equity > Share capital')
    expect(suggestionKey({ label: 'Inventories', breadcrumb: '' })).toBe('Inventories')
  })
})

describe('acceptTopSuggestions', () => {
  it('fills only untagged rows that have a suggestion', () => {
    const base = rowsFromTransform(transform)
    const rows: TagRow[] = [
      { ...base[0], suggestions: [{ qname: 'ind-as:EquityShareCapital', label: '', score: 0.99, type: null, periodType: null, balance: null }] },
      { ...base[1], concept: 'ind-as:Inventories', suggestions: [{ qname: 'ind-as:Other', label: '', score: 0.5, type: null, periodType: null, balance: null }] },
      base[2],
    ]
    expect(acceptTopSuggestions(rows).map((r) => r.concept)).toEqual(['ind-as:EquityShareCapital', 'ind-as:Inventories', ''])
  })
})

describe('prefillMasters', () => {
  const meta = { nature: 'Consolidated' as const, startDate: '2025-04-01', endDate: '2026-03-31' }
  it('fills period and nature fields the app already knows, keeping what the user typed', () => {
    const fields = [field('in-ca:DateOfStartOfReportingPeriod', 'dateItemType'), field('in-ca:DateOfEndOfReportingPeriod', 'dateItemType'), field('in-ca:NatureOfReportStandaloneConsolidated'), field('in-ca:NameOfCompany')]
    expect(prefillMasters(fields, meta, { 'in-ca:DateOfEndOfReportingPeriod': '2026-03-30' })).toEqual({
      'in-ca:DateOfStartOfReportingPeriod': '2025-04-01',
      'in-ca:DateOfEndOfReportingPeriod': '2026-03-30',
      'in-ca:NatureOfReportStandaloneConsolidated': 'Consolidated',
    })
  })
})

describe('fieldKind', () => {
  it('maps XBRL item types to editors', () => {
    expect(fieldKind('dateItemType')).toBe('date')
    expect(fieldKind('booleanItemType')).toBe('boolean')
    expect(fieldKind('textBlockItemType')).toBe('longtext')
    expect(fieldKind('CINNumber')).toBe('text')
  })
})

describe('readinessProblems and buildGenerateInput', () => {
  const meta = { nature: 'Standalone' as const, startDate: '2025-04-01', endDate: '2026-03-31' }
  const rows = rowsFromTransform(transform).map((r, i) => (i === 0 ? { ...r, concept: 'ind-as:EquityShareCapital' } : r))
  const companyFields = [field('in-ca:NameOfCompany'), field('in-ca:CorporateIdentityNumber')]

  it('lists what would make generation fail', () => {
    const p = readinessProblems({ rows: rowsFromTransform(transform), meta: { ...meta, endDate: '' }, signatories: [{ din: '123', name: '', designation: 'Director' }], companyFields, company: { 'in-ca:NameOfCompany': 'Acme' } })
    expect(p).toEqual([
      'Enter the financial year start and end dates.',
      'Tag at least one statement line.',
      'Fill the company details: CorporateIdentityNumber.',
      'Add at least 2 signatory directors.',
      'Signatory 1: DIN must be 8 digits.',
    ])
  })

  it('is ready when everything is filled', () => {
    const signatories = [
      { din: '01234567', name: 'A', designation: 'Director' },
      { din: '76543210', name: 'B', designation: 'Director' },
    ]
    expect(readinessProblems({ rows, meta, signatories, companyFields, company: { 'in-ca:NameOfCompany': 'Acme', 'in-ca:CorporateIdentityNumber': 'U1' } })).toEqual([])
  })

  it('sends only accepted tags, per statement, and names the file after the company', () => {
    const input = buildGenerateInput({ rows, meta, company: { 'in-ca:NameOfCompany': 'Acme Pvt Ltd' }, auditor: {}, signatories: [] })
    expect(input.statements).toEqual({ balanceSheet: [{ concept: 'ind-as:EquityShareCapital', cy: 417830, py: 390220 }], profitLoss: [] })
    expect(input.companyName).toBe('Acme Pvt Ltd')
  })
})
