import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CellRef } from '@shared/workbook'
import { AppDatabase } from '../electron/main/infra/app-database'
import { DirAutosaveStore } from '../electron/main/infra/dir-autosave-store'
import { FileAuthorityProvider } from '../electron/main/infra/file-authority-provider'
import { readXlsx } from '../electron/main/infra/xlsx-reader'
import { EditorQueryService } from '../electron/main/services/editor-query-service'
import { ValidationError } from '../electron/main/services/errors'
import { MappingService } from '../electron/main/services/mapping-service'
import { ProjectService } from '../electron/main/services/project-service'
import { SourceService } from '../electron/main/services/source-service'

const AUTHORITY = resolve(__dirname, '../../engine/authority/ci-2016.authority.json')
const SAMPLE = resolve(__dirname, '../../data/sample_financials.xlsx')
const BS = 'http://www.icai.org/xbrl/taxonomy/role/in-gaap/BalanceSheet'
const authority = new FileAuthorityProvider(AUTHORITY)

describe.skipIf(!existsSync(AUTHORITY))('editor services on the sample workbook', () => {
  let dir: string
  let projects: ProjectService
  let sources: SourceService
  let mapping: MappingService
  let editor: EditorQueryService
  const cell = (sheet: string, ref: string): CellRef => ({ workbook: 'workbook-1.xlsx', sheet, ref })

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'xap-editor-'))
    projects = new ProjectService({ authority, recents: new AppDatabase(':memory:'), autosave: new DirAutosaveStore(join(dir, 'a')), appVersion: '0.1.0' })
    sources = new SourceService(projects, readXlsx)
    mapping = new MappingService(projects, sources)
    editor = new EditorQueryService(projects, () => mapping.list(), () => '2014-09-30')
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

    const form = editor.form(BS)
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
  })

  it('refuses text for amounts, empty cells and table-only elements with clear messages', async () => {
    await expect(mapping.tag({ cell: cell('BS', 'A9'), concept: 'in-gaap:ShareCapital', scope: 'CY' })).rejects.toThrow(/not a number/)
    await expect(mapping.tag({ cell: cell('BS', 'C12'), concept: 'in-gaap:ShareCapital', scope: 'CY' })).rejects.toThrow(/empty/)
    const tableOnly = editor.searchConcepts('classes of share capital').find((h) => !h.nonDimensional)
    if (tableOnly) await expect(mapping.tag({ cell: cell('BS', 'C9'), concept: tableOnly.qname })).rejects.toBeInstanceOf(ValidationError)
  })

  it('searches the taxonomy with statement-level elements first', () => {
    const hits = editor.searchConcepts('share capital')
    expect(hits[0]).toMatchObject({ qname: 'in-gaap:ShareCapital', nonDimensional: true, periodType: 'instant', balance: 'credit' })
    expect(hits[0]!.elrCodes).toContain('100100')
    expect(editor.searchConcepts('')).toEqual([])
  })

  it('saves sources and mapping in the .axbrl and restores them on open', async () => {
    await mapping.tag({ cell: cell('BS', 'C9'), concept: 'in-gaap:ShareCapital' })
    const file = join(dir, 'xbrl-ltd.axbrl')
    await projects.saveAs(file)

    const reopened = new ProjectService({ authority, recents: new AppDatabase(':memory:'), autosave: new DirAutosaveStore(join(dir, 'b')), appVersion: '0.1.0' })
    await reopened.open(file)
    const src2 = new SourceService(reopened, readXlsx)
    const map2 = new MappingService(reopened, src2)
    expect((await src2.workbooks())[0]!.fileName).toBe('sample_financials.xlsx')
    expect(map2.list()).toEqual([expect.objectContaining({ cell: cell('BS', 'C9'), value: '60000000' })])
    expect(reopened.summary()!.dirty).toBe(false)
  })
})
