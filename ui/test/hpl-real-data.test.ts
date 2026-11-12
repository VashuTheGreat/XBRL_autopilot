/**
 * Phase 5 real-data run: Helmier Pvt Ltd (C&I, FY 2025-26, ₹ lakhs) hand-tagged from its own workbook, exactly as a
 * user would (cell → element, ranges summed, columns by header), checked against the filed instance
 * (data/Instance_Helmier_Private_Limited__2025-26.xml.pdf, docs/12-reference-data.md).
 * Confidential client data: it stays in this process (no sidecar, no AI service).
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { Gate } from '@xap/engine'
import type { Scope } from '@shared/editor'
import type { CellRef } from '@shared/workbook'
import { AppDatabase } from '../electron/main/infra/app-database'
import { DirAutosaveStore } from '../electron/main/infra/dir-autosave-store'
import { FileAuthorityProvider } from '../electron/main/infra/file-authority-provider'
import { capWorkbook, workbookParser } from '../electron/main/infra/workbook-parser'
import { readXlsx } from '../electron/main/infra/xlsx-reader'
import { ColumnPeriodService } from '../electron/main/services/column-period-service'
import { EditorQueryService } from '../electron/main/services/editor-query-service'
import { MappingService } from '../electron/main/services/mapping-service'
import { ProjectService } from '../electron/main/services/project-service'
import { SourceService } from '../electron/main/services/source-service'
import { StatementService } from '../electron/main/services/statement-service'

const AUTHORITY = resolve(__dirname, '../../engine/authority/ci-2016.authority.json')
const HPL = resolve(__dirname, '../../data/HPL -M26 - Financials_final cross checked with print_8th sep (3).xlsx')
const TODAY = '2026-11-10'

/** row → element. Columns: D = 31 March 2026 (CY), E = 31 March 2025 (PY), F = 2024 (not part of this filing). */
const BALANCE_SHEET: [string, string][] = [
  ['12', 'ShareCapital'], ['13', 'ReservesAndSurplus'], ['14', 'ShareholdersFunds'],
  ['16', 'OtherLongTermLiabilities'], ['17', 'LongTermProvisions'], ['18', 'NoncurrentLiabilities'],
  ['20', 'ShortTermBorrowings'], ['22:23', 'TradePayables'], // no total cell: the MSME / other lines are summed
  ['24', 'OtherCurrentLiabilities'], ['25', 'ShortTermProvisions'], ['26', 'CurrentLiabilities'], ['28', 'EquityAndLiabilities'],
  ['33', 'TangibleAssets'], ['34', 'TangibleAssetsCapitalWorkInProgress'], // Total fixed assets: derived (no cell)
  ['35', 'DeferredTaxAssetsNet'], ['36', 'LongTermLoansAndAdvances'], ['37', 'OtherNoncurrentAssets'], ['38', 'NoncurrentAssets'],
  ['40', 'Inventories'], ['41', 'TradeReceivables'], ['42', 'CashAndBankBalances'], ['43', 'ShortTermLoansAndAdvances'],
  ['44', 'OtherCurrentAssets'], ['45', 'CurrentAssets'], ['47', 'Assets'],
]
const PROFIT_AND_LOSS: [string, string][] = [
  ['8', 'RevenueFromOperations'], ['9', 'OtherIncome'], ['10', 'Revenue'],
  ['13', 'CostOfMaterialsConsumed'], ['14', 'PurchasesOfStockInTrade'], ['15', 'ChangesInInventoriesOfFinishedGoodsWorkInProgressAndStockInTrade'],
  ['16', 'EmployeeBenefitExpense'], ['17', 'FinanceCosts'], ['18', 'DepreciationExpense'], ['19', 'OtherExpenses'], ['20', 'Expenses'],
  ['22', 'ProfitBeforeTax'], ['25', 'CurrentTax'], ['26', 'DeferredTax'], ['27', 'TaxExpense'], ['29', 'ProfitLossForPeriod'],
  ['32', 'BasicEarningPerEquityShare'], ['33', 'DilutedEarningsPerEquityShare'],
]
/** Note 21 (columns E = 2026, F = 2025): the revenue split the P&L statement reports (mandatory SR-L3452 / SR-L3456). */
const NOTE_21: [string, string][] = [['8', 'RevenueFromSaleOfProducts'], ['9', 'RevenueFromSaleOfServices']]

/**
 * The filed figures (₹ lakhs; EPS in ₹), from the instance PDF. Where the filer departed from the statement,
 * the statement's figure is expected and the filed one noted:
 *   Inventories 4,879.73 and Other current assets 794.79 were adjusted by the filer (the statement shows 4,879.74 / 794.78;
 *   both sets foot to 7,864.31); Other expenses 1,763.05 + CSR expenditure 17 (split out from the note) = 1,780.05.
 */
const KEY: Record<string, [string, string]> = {
  ShareCapital: ['4.1783', '3.9022'], ReservesAndSurplus: ['5443.47', '3068.48'], ShareholdersFunds: ['5447.65', '3072.38'],
  OtherLongTermLiabilities: ['16.1', '19.35'], LongTermProvisions: ['148.09', '89.27'], NoncurrentLiabilities: ['164.19', '108.62'],
  ShortTermBorrowings: ['678.09', '613.62'], TradePayables: ['3494.98', '2597.09'], OtherCurrentLiabilities: ['1004.52', '674.78'],
  ShortTermProvisions: ['115.25', '105.18'], CurrentLiabilities: ['5292.84', '3990.67'], EquityAndLiabilities: ['10904.68', '7171.67'],
  TangibleAssets: ['370.8', '325.96'], TangibleAssetsCapitalWorkInProgress: ['487.14', '17.04'], FixedAssets: ['857.94', '343'],
  DeferredTaxAssetsNet: ['54.59', '37.5'], LongTermLoansAndAdvances: ['132.78', '85.46'], OtherNoncurrentAssets: ['1995.06', '243.63'],
  NoncurrentAssets: ['3040.37', '709.59'], Inventories: ['4879.74', '3314.24'], TradeReceivables: ['162.08', '250.85'],
  CashAndBankBalances: ['1959.58', '2269.26'], ShortTermLoansAndAdvances: ['68.13', '60.03'], OtherCurrentAssets: ['794.78', '567.7'],
  CurrentAssets: ['7864.31', '6462.08'], Assets: ['10904.68', '7171.67'],
  RevenueFromSaleOfProducts: ['16267.31', '14042.89'], RevenueFromSaleOfServices: ['27.79', '11.98'],
  RevenueFromOperationsOtherThanFinanceCompany: ['16295.1', '14054.87'], RevenueFromOperations: ['16295.1', '14054.87'], OtherIncome: ['112.88', '133.69'], Revenue: ['16407.98', '14188.56'],
  CostOfMaterialsConsumed: ['1359.59', '259.19'], PurchasesOfStockInTrade: ['10867.26', '10097.89'],
  ChangesInInventoriesOfFinishedGoodsWorkInProgressAndStockInTrade: ['-1626.44', '-1007.78'], EmployeeBenefitExpense: ['2497.45', '1955.71'],
  FinanceCosts: ['51.71', '21.12'], DepreciationExpense: ['41.98', '33.14'], DepreciationDepletionAndAmortisationExpense: ['41.98', '33.14'],
  OtherExpenses: ['1780.05', '1462.29'], Expenses: ['14971.6', '12821.56'], ProfitBeforeTax: ['1436.38', '1367'],
  CurrentTax: ['387.19', '351.12'], DeferredTax: ['-17.09', '7.2'], TaxExpense: ['370.1', '358.32'], ProfitLossForPeriod: ['1066.28', '1008.68'],
  BasicEarningPerEquityShare: ['3385.02', '3202.16'], DilutedEarningsPerEquityShare: ['2551.95', '2584.9'],
}

describe.skipIf(!existsSync(HPL) || !existsSync(AUTHORITY))('HPL (C&I) hand-tagged end to end', () => {
  const authority = new FileAuthorityProvider(AUTHORITY)
  let projects: ProjectService
  let sources: SourceService
  let mapping: MappingService
  let editor: EditorQueryService
  let zeroFilled: string[] = []
  const at = (sheet: string, ref: string): CellRef => ({ workbook: 'workbook-1.xlsx', sheet, ref })
  const ref = (col: string, rows: string) => rows.split(':').map((r) => col + r).join(':')
  const value = (local: string, scope: Scope) => {
    const f = projects.session().getValue(`in-gaap:${local}`, scope)
    return f ? String(projects.session().displayOf(f)) : null
  }

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xap-hpl-'))
    projects = new ProjectService({ authority, recents: new AppDatabase(':memory:'), autosave: new DirAutosaveStore(join(dir, 'a')), appVersion: '0.1.0' })
    sources = new SourceService(projects, workbookParser({ xlsx: readXlsx, xls: () => Promise.reject(new Error('no .xls here')) }))
    const columns = new ColumnPeriodService(projects, sources)
    mapping = new MappingService(projects, sources, columns)
    editor = new EditorQueryService(projects, () => mapping.list(), null as never, () => TODAY)
    await projects.newFiling({
      companyName: 'Helmier Private Limited',
      cin: 'U85100MH2021PTC366828',
      reportType: 'Standalone',
      cy: { start: '2025-04-01', end: '2026-03-31' },
      py: { start: '2024-04-01', end: '2025-03-31' },
      level: 'Lakhs',
      statementPlaces: 2,
    })
    const wb = await sources.importWorkbook('HPL -M26 - Financials.xlsx', readFileSync(HPL))
    expect(wb.sheets.find((s) => s.name === 'payables- mar 26')?.cells.length).toBeGreaterThan(1_000_000)
    expect(capWorkbook(wb).sheets.find((s) => s.name === 'payables- mar 26')?.truncated?.totalCells).toBeGreaterThan(1_000_000)

    const plan = [['Balance Sheet', BALANCE_SHEET, ['D', 'E']], ['P&L Statement', PROFIT_AND_LOSS, ['D', 'E']], ['Note 21-28', NOTE_21, ['E', 'F']]] as const
    for (const [sheet, rows, cols] of plan) {
      for (const [r, local] of rows) {
        for (const col of cols) await mapping.tag({ cell: at(sheet, ref(col, r)), concept: `in-gaap:${local}` })
      }
    }
    // the lines HPL doesn't have, as its filed instance reports them: 0
    const statements = new StatementService(projects)
    const A = projects.project().authority.authority
    for (const code of ['100100', '100200']) {
      const uri = (A.elrs as { code: string; uri: string }[]).find((e) => e.code === code)!.uri
      zeroFilled.push(...statements.fillMandatoryZeros(uri).map((z) => `${z.concept.split(':')[1]} ${z.scope}`))
    }
  }, 120_000)

  /**
   * Known divergence: CSR expenditure is mandatory on the P&L and HPL's statement has no line for it, so it is filled
   * with 0. The filer split ₹17 lakhs (PY 7.5) of CSR out of "Other expenses" using the notes. The fill is an explicit
   * action that lists what it filled, so the user can correct such a line.
   */
  it('reports the mandatory lines HPL does not have as 0, as the filed instance does', () => {
    expect(zeroFilled.sort()).toEqual(
      ['CSRExpenditure', 'CurrentInvestments', 'IntangibleAssets', 'LongTermBorrowings', 'NoncurrentInvestments', 'ShareApplicationMoneyPendingAllotment']
        .flatMap((l) => [`${l} CY`, `${l} PY`])
        .sort(),
    )
    expect(value('LongTermBorrowings', 'CY')).toBe('0')
    // a total that follows its parts is unchanged by a zero part
    expect(value('NoncurrentLiabilities', 'CY')).toBe('164.19')
  })

  it('reads the columns by their headers: 2026 = CY, 2025 = PY, 2024 is not part of the filing', async () => {
    const col = async (c: string) => (await mapping.cellInfo(at('Balance Sheet', `${c}12`))).column
    expect(await col('D')).toMatchObject({ scope: 'CY', basis: 'header' })
    expect(await col('E')).toMatchObject({ scope: 'PY', basis: 'header' })
    expect(await col('F')).toMatchObject({ scope: null, basis: 'outside' })
    await expect(mapping.tag({ cell: at('Balance Sheet', 'F12'), concept: 'in-gaap:ShareCapital' })).rejects.toThrow(/isn’t part of this filing/)
  })

  it('every statement figure matches the filed instance (float noise rounded, share capital exact, totals derived)', () => {
    const got: Record<string, [string | null, string | null]> = {}
    for (const local of Object.keys(KEY)) got[local] = [value(local, 'CY'), value(local, 'PY')]
    expect(got).toEqual(KEY)
  })

  it('declares share capital to the rupee and statement figures as presented', () => {
    const f = (local: string) => projects.session().getValue(`in-gaap:${local}`, 'CY') as { value: string; decimals: string }
    expect(f('ShareCapital')).toMatchObject({ value: '417830', decimals: '0' })
    expect(f('ReservesAndSurplus')).toMatchObject({ value: '544347000', decimals: '-3' })
    expect(f('BasicEarningPerEquityShare')).toMatchObject({ value: '3385.02' }) // ₹ per share: never scaled by lakhs
  })

  /**
   * The statements themselves are clean: every remaining error asks for a NOTE (a dimensional table, or the note
   * breakdown of a statement line in [200600]), which is tagged in a later phase (tables). Nothing is wrong with a
   * statement figure, a total, a decimals attribute or a mandatory statement line.
   */
  it('the Balance Sheet and the P&L have no errors of their own; what remains asks for notes', () => {
    const A = projects.project().authority.authority
    const rules = new Map((A.rules.rules as { id: string; ast?: { type: string } }[]).map((r) => [r.id, r]))
    for (const code of ['100100', '100200']) {
      const uri = (A.elrs as { code: string; uri: string }[]).find((e) => e.code === code)!.uri
      const res = new Gate(A).run(projects.session().filing, { today: TODAY, tab: uri } as never) as { issues: { severity: string; code: string; message: string }[] }
      const errors = res.issues.filter((i) => i.severity === 'ERROR')
      const asksForNotes = (i: { code: string; message: string }) =>
        rules.get(i.code.replace(/^rule\./, ''))?.ast?.type === 'tableRequired' || /none of its calculation children are entered \(\[[23]\d{5}\] Notes/.test(i.message)
      expect(errors.filter((i) => !asksForNotes(i)).map((i) => `${i.code}: ${i.message}`), code).toEqual([])
    }
  })

  it('generates the XML with every tagged fact', () => {
    const xml = editor.xml()
    expect(xml.xml).toContain('<in-gaap:ShareCapital contextRef="I2026" unitRef="INR" decimals="0">417830</in-gaap:ShareCapital>')
    expect(xml.xml).toMatch(/<in-gaap:TradePayables [^>]*decimals="-3">349498000<\/in-gaap:TradePayables>/)
    expect(Object.keys(xml.factLines).length).toBeGreaterThanOrEqual(2 * (BALANCE_SHEET.length + PROFIT_AND_LOSS.length))
  })
})
