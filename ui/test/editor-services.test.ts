import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { CellRef } from '@shared/workbook'
import { AppDatabase } from '../electron/main/infra/app-database'
import { DirAutosaveStore } from '../electron/main/infra/dir-autosave-store'
import { FileAuthorityProvider } from '../electron/main/infra/file-authority-provider'
import { SidecarTaxonomyCatalog } from '../electron/main/infra/sidecar-taxonomy-catalog'
import { readXlsx } from '../electron/main/infra/xlsx-reader'
import { ColumnPeriodService } from '../electron/main/services/column-period-service'
import { EditorQueryService } from '../electron/main/services/editor-query-service'
import { FilingPropertiesService } from '../electron/main/services/filing-properties-service'
import { ValidationError } from '../electron/main/services/errors'
import { MappingService } from '../electron/main/services/mapping-service'
import { ProjectService } from '../electron/main/services/project-service'
import { SourceService } from '../electron/main/services/source-service'
import { StatementService } from '../electron/main/services/statement-service'
import { TaxonomyService } from '../electron/main/services/taxonomy-service'
import { SidecarManager } from '../electron/main/sidecar'

const AUTHORITY = resolve(__dirname, '../../engine/authority/ci-2016.authority.json')
const SAMPLE = resolve(__dirname, '../../data/sample_financials.xlsx')
const BS = 'http://www.icai.org/xbrl/taxonomy/role/in-gaap/BalanceSheet'
const authority = new FileAuthorityProvider(AUTHORITY)
const REPO = resolve(__dirname, '../..')

// The real FastAPI sidecar (uv run python -m api) serves the taxonomy routes: no fakes for the contract under test.
let sidecar: SidecarManager
let catalog: SidecarTaxonomyCatalog
beforeAll(async () => {
  sidecar = new SidecarManager({ isPackaged: false, repoRoot: REPO, resourcesPath: '' })
  void sidecar.start()
  await sidecar.whenReady(170_000)
  catalog = new SidecarTaxonomyCatalog(sidecar)
}, 180_000)
afterAll(async () => {
  await sidecar?.stop()
})

describe.skipIf(!existsSync(AUTHORITY))('editor services on the sample workbook', () => {
  let dir: string
  let projects: ProjectService
  let sources: SourceService
  let mapping: MappingService
  let columns: ColumnPeriodService
  let editor: EditorQueryService
  let taxonomy: TaxonomyService
  const cell = (sheet: string, ref: string): CellRef => ({ workbook: 'workbook-1.xlsx', sheet, ref })

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'xap-editor-'))
    projects = new ProjectService({ authority, recents: new AppDatabase(':memory:'), autosave: new DirAutosaveStore(join(dir, 'a')), appVersion: '0.1.0' })
    sources = new SourceService(projects, readXlsx)
    columns = new ColumnPeriodService(projects, sources)
    mapping = new MappingService(projects, sources, columns)
    editor = new EditorQueryService(projects, () => mapping.list(), catalog, () => '2014-09-30')
    taxonomy = new TaxonomyService(projects, catalog)
    await projects.newFiling({
      companyName: 'XBRL Ltd',
      cin: 'U72200KA2010PLC123456',
      reportType: 'Standalone',
      cy: { start: '2013-04-01', end: '2014-03-31' },
      py: { start: '2012-04-01', end: '2013-03-31' },
      level: 'Actual',
    })
    await sources.importWorkbook('sample_financials.xlsx', readFileSync(SAMPLE))
  })

  it('imports the workbook into the project and marks it dirty', async () => {
    const s = projects.summary()!
    expect(s.sources).toEqual(['workbook-1.xlsx'])
    expect((await sources.workbooks())[0]!.sheets.map((x) => x.name)).toEqual(['BS', 'PL', 'BS Sch'])
    expect(await sources.rowLabel(cell('BS', 'C9'))).toBe('- Share Capital')
  })

  it('tags Share Capital for both years, inferring CY/PY from the column headers', async () => {
    const cy = await mapping.tag({ cell: cell('BS', 'C9'), concept: 'in-gaap:ShareCapital' })
    const py = await mapping.tag({ cell: cell('BS', 'D9'), concept: 'in-gaap:ShareCapital' })
    expect([cy.fact.scope, py.fact.scope]).toEqual(['CY', 'PY'])
    expect([cy.value, py.value]).toEqual(['60000000', '30000000'])
    expect(cy).toMatchObject({ label: '- Share Capital', origin: 'manual', status: 'approved', conceptLabel: expect.stringMatching(/share capital/i) })

    const form = await editor.form(BS)
    const row = form.rows.find((r) => r.concept === 'in-gaap:ShareCapital')!
    expect(row.cy).toMatchObject({ display: '60000000', source: cell('BS', 'C9'), mappingId: cy.id })
    expect(row.py).toMatchObject({ display: '30000000', source: cell('BS', 'D9') })
    expect(form.code).toBe('100100')

    const xml = editor.xml()
    const line = xml.xml.split('\n')[xml.factLines[cy.factKey!]! - 1]!
    expect(line).toContain('<in-gaap:ShareCapital ')
    expect(line).toContain('>60000000<')
  })

  it('keeps negative amounts and applies an explicit sign', async () => {
    const r = await mapping.tag({ cell: cell('BS', 'C10'), concept: 'in-gaap:ReservesAndSurplus' })
    expect(r.value).toBe('-343854')
    const flipped = await mapping.tag({ cell: cell('PL', 'C13'), concept: 'in-gaap:FinanceCosts', sign: -1 })
    expect(flipped.value).toBe('-1200000')
  })

  it('one cell → one fact: retagging a cell replaces its old fact', async () => {
    await mapping.tag({ cell: cell('BS', 'C14'), concept: 'in-gaap:LongTermBorrowings' })
    await mapping.tag({ cell: cell('BS', 'C14'), concept: 'in-gaap:ShareCapital' })
    expect(mapping.list()).toHaveLength(1)
    expect(projects.session().getValue('in-gaap:LongTermBorrowings', 'CY')).toBeNull()
  })

  it('one fact ← one cell: tagging another cell to the same fact moves the link', async () => {
    await mapping.tag({ cell: cell('BS', 'C9'), concept: 'in-gaap:ShareCapital' })
    const moved = await mapping.tag({ cell: cell('BS', 'C11'), concept: 'in-gaap:ShareCapital', scope: 'CY' })
    expect(mapping.list().map((m) => m.cell.ref)).toEqual(['C11'])
    expect(moved.value).toBe('59656146')
  })

  it('untag removes the fact; setScope moves it to the other year', async () => {
    const m = await mapping.tag({ cell: cell('BS', 'C9'), concept: 'in-gaap:ShareCapital' })
    const moved = await mapping.setScope(m.id, 'PY')
    expect(moved.fact.scope).toBe('PY')
    expect(projects.session().getValue('in-gaap:ShareCapital', 'CY')).toBeNull()
    mapping.untag(moved.id)
    expect(projects.session().getValue('in-gaap:ShareCapital', 'PY')).toBeNull()
    expect(mapping.list()).toEqual([])
    // correcting a cell's period corrects its column
    expect((await mapping.cellInfo(cell('BS', 'C14'))).column).toMatchObject({ column: 'C', scope: 'PY', basis: 'remembered' })
  })

  it('reports a cell’s amount and its column’s period for the inspector', async () => {
    const info = await mapping.cellInfo(cell('BS', 'C9'))
    expect(info.amount).toMatchObject({ value: '60000000', rounded: false })
    expect(info.column).toEqual({ column: 'C', scope: 'CY', basis: 'header', reason: 'column header “31.03.2014”' })
    expect((await mapping.cellInfo(cell('BS', 'A9'))).amount).toBeNull()
  })

  it('never guesses a column whose header names another year: asks, then remembers the choice per sheet', async () => {
    await projects.newFiling({
      companyName: 'XBRL Ltd',
      cin: 'U72200KA2010PLC123456',
      reportType: 'Standalone',
      cy: { start: '2015-04-01', end: '2016-03-31' },
      py: { start: '2014-04-01', end: '2015-03-31' },
      level: 'Actual',
    })
    await sources.importWorkbook('sample_financials.xlsx', readFileSync(SAMPLE))
    expect((await mapping.cellInfo(cell('BS', 'C9'))).column).toMatchObject({ scope: null, basis: 'outside' })
    await expect(mapping.tag({ cell: cell('BS', 'C9'), concept: 'in-gaap:ShareCapital' })).rejects.toThrow(/Column C isn’t part of this filing/)

    await columns.set(cell('BS', 'C9'), 'CY')
    expect((await mapping.tag({ cell: cell('BS', 'C9'), concept: 'in-gaap:ShareCapital' })).fact.scope).toBe('CY')
    expect((await mapping.cellInfo(cell('BS', 'C14'))).column).toMatchObject({ scope: 'CY', basis: 'remembered' })
    expect((await mapping.cellInfo(cell('PL', 'C6'))).column.basis).toBe('outside') // per sheet
    await columns.set(cell('BS', 'C9'), null)
    expect((await mapping.cellInfo(cell('BS', 'C14'))).column.basis).toBe('outside')
  })

  it('refuses an amount whose shown digits a rupee filing cannot hold (finer than paise): nothing is rounded away', async () => {
    const sheet = await sources.sheet(cell('BS', 'C9'))
    const c9 = sheet.cells.find((c) => c.r === 8 && c.c === 2)!
    c9.v = 1234.5678
    c9.numFmt = '#,##0.000'
    await expect(mapping.tag({ cell: cell('BS', 'C9'), concept: 'in-gaap:ReservesAndSurplus' })).rejects.toThrow(/1234\.568 \(3 decimal places\).*at most 2/)
    c9.numFmt = '#,##0.00'
    expect((await mapping.tag({ cell: cell('BS', 'C9'), concept: 'in-gaap:ReservesAndSurplus' })).value).toBe('1234.57')
  })

  it('tags a one-column range as the sum of its cells, and keeps one cell → one fact', async () => {
    // C14 1283442 + C15 12000 (both long-term lines of the sample)
    const sum = await mapping.tag({ cell: cell('BS', 'C14:C15'), concept: 'in-gaap:LongTermBorrowings' })
    expect(sum).toMatchObject({ value: '1295442', fact: { scope: 'CY' } })
    expect(mapping.byCell().get('workbook-1.xlsx|BS|C15')?.id).toBe(sum.id)
    expect((await mapping.cellInfo(cell('BS', 'C14:C15'))).amount?.value).toBe('1295442')
    // tagging a cell inside the range replaces the range's tag
    await mapping.tag({ cell: cell('BS', 'C15'), concept: 'in-gaap:OtherLongTermLiabilities' })
    expect(mapping.list().map((m) => m.cell.ref)).toEqual(['C15'])
    expect(projects.session().getValue('in-gaap:LongTermBorrowings', 'CY')).toBeNull()
    await expect(mapping.tag({ cell: cell('BS', 'C14:D14'), concept: 'in-gaap:LongTermBorrowings' })).rejects.toThrow(/one column/)
  })

  it('re-pulls tagged figures from Excel when the decimal places as presented change', async () => {
    const sheet = await sources.sheet(cell('BS', 'C10'))
    sheet.cells.find((c) => c.r === 9 && c.c === 2)!.v = -343854.4567 // no number format: statement places decide
    const m = await mapping.tag({ cell: cell('BS', 'C10'), concept: 'in-gaap:ReservesAndSurplus' })
    expect(m.value).toBe('-343854')
    const props = new FilingPropertiesService(projects, mapping)
    expect(await props.setStatementPlaces(2)).toEqual([])
    expect(projects.summary()!.statementPlaces).toBe(2)
    expect(mapping.list()[0]!.value).toBe('-343854.46')
    await expect(props.setStatementPlaces(3)).rejects.toThrow(/0 to 2/)
  })

  it('refuses text for amounts, empty cells and table-only elements with clear messages', async () => {
    await expect(mapping.tag({ cell: cell('BS', 'A9'), concept: 'in-gaap:ShareCapital', scope: 'CY' })).rejects.toThrow(/not a number/)
    await expect(mapping.tag({ cell: cell('BS', 'C12'), concept: 'in-gaap:ShareCapital', scope: 'CY' })).rejects.toThrow(/empty/)
    const tableOnly = (await taxonomy.searchConcepts('classes of share capital')).find((h) => !h.nonDimensional)
    if (tableOnly) await expect(mapping.tag({ cell: cell('BS', 'C9'), concept: tableOnly.qname })).rejects.toBeInstanceOf(ValidationError)
  })

  it('searches the taxonomy through the FastAPI route, enriched with the engine’s table knowledge', async () => {
    const hits = await taxonomy.searchConcepts('share capital')
    expect(hits[0]).toMatchObject({ qname: 'in-gaap:ShareCapital', nonDimensional: true, periodType: 'instant', balance: 'credit' })
    expect(hits[0]!.elrCodes).toContain('100100')
    expect(await taxonomy.searchConcepts('')).toEqual([])
  })

  it('lists statements from the /elrs route, grouped by title', async () => {
    const elrs = await taxonomy.elrs()
    expect(elrs).toHaveLength(47)
    expect(elrs[0]).toMatchObject({ code: '100100', title: 'Balance sheet', group: 'Statements' })
    expect(new Set(elrs.map((e) => e.group))).toEqual(new Set(['Statements', 'Notes', 'Disclosures']))
  })

  it('builds the XBRL Form structure from the /tree route', async () => {
    const form = await editor.form(BS)
    expect(form).toMatchObject({ code: '100100', title: 'Balance sheet' })
    expect(form.rows[0]).toMatchObject({ kind: 'header', depth: 0 })
    const share = form.rows.find((r) => r.concept === 'in-gaap:ShareCapital')!
    expect(share).toMatchObject({ kind: 'item', cy: { display: '' } })
    expect(form.rows.filter((r) => r.kind === 'item' && !r.dimensional).length).toBeGreaterThan(30)
  })

  it('saves sources and mapping in the .axbrl and restores them on open', async () => {
    await mapping.tag({ cell: cell('BS', 'C9'), concept: 'in-gaap:ShareCapital' })
    await columns.set(cell('BS', 'D9'), 'PY')
    const file = join(dir, 'xbrl-ltd.axbrl')
    await projects.saveAs(file)

    const reopened = new ProjectService({ authority, recents: new AppDatabase(':memory:'), autosave: new DirAutosaveStore(join(dir, 'b')), appVersion: '0.1.0' })
    await reopened.open(file)
    const src2 = new SourceService(reopened, readXlsx)
    const map2 = new MappingService(reopened, src2, new ColumnPeriodService(reopened, src2))
    expect((await src2.workbooks())[0]!.fileName).toBe('sample_financials.xlsx')
    expect(map2.list()).toEqual([expect.objectContaining({ cell: cell('BS', 'C9'), value: '60000000' })])
    expect(reopened.summary()!.dirty).toBe(false)
    expect((await new ColumnPeriodService(reopened, src2).of(cell('BS', 'D20'))).basis).toBe('remembered')
  })

  it('tags a date cell parsing DMY / text into ISO YYYY-MM-DD (ADR-0013 step 5)', async () => {
    // BS!C5 holds "31.03.2014"
    const tagged = await mapping.tag({ cell: cell('BS', 'C5'), concept: 'in-ca:DateOfBoardMeetingWhenFinalAccountsWereApproved', scope: 'CY' })
    expect(tagged.value).toBe('2014-03-31')
    expect(projects.session().getValue('in-ca:DateOfBoardMeetingWhenFinalAccountsWereApproved', 'CY')?.value).toBe('2014-03-31')
  })

  it('tags a text block range joining rows into MCA paragraphs (ADR-0013 step 5)', async () => {
    // BS!A1:A2 holds "XBRL Ltd" and "Balance Sheet"
    const tagged = await mapping.tag({ cell: cell('BS', 'A1:A2'), concept: 'in-gaap:AccountingPolicyOnInventoriesTextBlock', scope: 'CY' })
    expect(tagged.value).toBe('<p>XBRL Ltd</p><p>Balance Sheet</p>')
    expect(projects.session().getValue('in-gaap:AccountingPolicyOnInventoriesTextBlock', 'CY')?.value).toBe('<p>XBRL Ltd</p><p>Balance Sheet</p>')
  })

  it('prefills disclosure filing details from last year’s instance / set-aside facts (ADR-0013 step 5)', async () => {
    const session = projects.session()
    // simulate set-aside facts from last year's filing
    const pyPeriod = session.periodForCell('in-ca:WhetherCompanyIsListedCompany', 'PY')!
    session.filing.setAside = [
      {
        concept: 'in-ca:WhetherCompanyIsListedCompany',
        period: pyPeriod,
        dims: [],
        value: 'false',
        nil: false,
        source: 'last_year.xml',
        reason: 'notApplicablePreviousYear',
      },
    ]
    const statements = new StatementService(projects)
    const res = statements.prefillDisclosures()
    expect(res.copied).toBeGreaterThanOrEqual(1)
    expect(session.getValue('in-ca:WhetherCompanyIsListedCompany', 'CY')?.value).toBe('false')
  })
})
