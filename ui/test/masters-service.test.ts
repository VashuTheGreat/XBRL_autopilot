/**
 * docs/14 Step 9: MastersService (the panel's sections from the knowledge base, writing the filing's CY facts, the
 * master library, fill from master), the library store, and the renderer's live field checks.
 * Synthetic C&I and Ind AS filings; golden: Dixon (Ind AS, DGPL's MCA-accepted instance) read back. Real client data
 * stays in this process (docs/12).
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { TaxonomyId } from '@xap/engine/basics'
import { cardKind, fieldProblems, gridKind, panNameConcepts, recordTitle, type MasterFieldView, type MastersView, type PanPairView } from '@shared/masters'
import { AppDatabase } from '../electron/main/infra/app-database'
import { DirAutosaveStore } from '../electron/main/infra/dir-autosave-store'
import { ValidationError } from '../electron/main/services/errors'
import { InstanceImportService } from '../electron/main/services/instance-import-service'
import { KeyValueMasterLibrary } from '../electron/main/services/master-library'
import { MastersService } from '../electron/main/services/masters-service'
import { ProjectService } from '../electron/main/services/project-service'
import { kbAuthorityService, kbReady } from './helpers/kb-authorities'

const DIXON = resolve(__dirname, '../../data/Instance_Dixon_Global_Private_2025-26_001.xml')
const NAME = 'in-ca:NameOfCompany'
const FIRST = 'in-ca:FirstNameOfDirector'
const DIN = 'in-ca:DirectorIdentificationNumberOfDirector'
const DESIGNATION = 'in-ca:DesignationOfDirector'
const FIRM = 'in-ca:NameOfAuditFirm'
const PAN = 'in-ca:PermanentAccountNumberOfAuditorOrAuditorsFirm'
const CATEGORY = 'in-ca:CategoryOfAuditor'

const directorsGrid = (v: MastersView) => v.sections.find((s) => s.id === 'signatories')!.grids.find((g) => g.columns.some((c) => c.concept === DIN))!
const auditorGrid = (v: MastersView) => v.sections.find((s) => s.id === 'auditor')!.grids[0]!
const company = (v: MastersView) => v.sections.find((s) => s.id === 'company')!

function setup(dir: string) {
  const authorities = kbAuthorityService()
  const db = new AppDatabase(':memory:')
  const projects = new ProjectService({ authority: authorities, recents: db, autosave: new DirAutosaveStore(join(dir, 'a')), appVersion: '0.1.0' })
  return { authorities, projects, db, service: new MastersService(projects, new KeyValueMasterLibrary(db, () => '2026-11-14T10:00:00Z')) }
}

describe.skipIf(!kbReady).each<[TaxonomyId]>([['ci-2016'], ['ind-as-2017']])('MastersService (%s)', (taxonomy) => {
  let projects: ProjectService
  let service: MastersService

  beforeEach(async () => {
    ;({ projects, service } = setup(mkdtempSync(join(tmpdir(), 'xap-masters-'))))
    await projects.newFiling({
      taxonomy, companyName: 'Synthetic Pvt Ltd', cin: 'U72200KA2010PTC123456', reportType: 'Standalone',
      cy: { start: '2025-04-01', end: '2026-03-31' }, py: { start: '2024-04-01', end: '2025-03-31' }, level: 'Lakhs', statementPlaces: 2,
    })
  })

  it('shows the company card with the New Filing details, and empty auditor and director grids', () => {
    const v = service.view()
    expect(v.sections.map((s) => s.id)).toEqual(['company', 'auditor', 'signatories'])
    expect(company(v).values[NAME]).toBe('Synthetic Pvt Ltd')
    expect(auditorGrid(v).rows).toEqual([])
    expect(directorsGrid(v).columns.find((c) => c.concept === DESIGNATION)!.options).toContain('Managing Director')
    expect(company(v).targets.map((t) => t.shared)).toContainEqual(['Name of company'])
  })

  it('writes the card and the grids to the filing facts and marks the project changed', () => {
    service.setItem({ concept: NAME, value: 'Synthetic Private Limited' })
    const member = service.newRow(directorsGrid(service.view()).tableId)
    const tableId = directorsGrid(service.view()).tableId
    service.setCell({ tableId, member, concept: FIRST, value: 'Asha' })
    service.setCell({ tableId, member, concept: DIN, value: '01234567' })
    expect(projects.session().getValue(NAME, 'CY')?.value).toBe('Synthetic Private Limited')
    expect(directorsGrid(service.view()).rows).toEqual([{ member, values: { [FIRST]: 'Asha', [DIN]: '01234567' } }])
    expect(projects.summary()?.dirty).toBe(true)
    service.removeRow({ tableId, member })
    expect(directorsGrid(service.view()).rows).toEqual([])
  })

  it('refuses what the engine refuses, and elements that are not masters', () => {
    const { tableId } = auditorGrid(service.view())
    const member = service.newRow(tableId)
    expect(() => service.setCell({ tableId, member, concept: CATEGORY, value: 'Partnership' })).toThrow(ValidationError)
    expect(() => service.setCell({ tableId, member, concept: NAME, value: 'x' })).toThrow(/not a column/)
    expect(() => service.setItem({ concept: FIRM, value: 'x' })).toThrow(/not on a master card/)
    expect(() => service.fill({ tableId: 'nope', from: { kind: 'library', ids: ['x'] } })).toThrow(/cannot be filled/)
  })

  it('fills the directors’ report signatories from the director grid, once', () => {
    const grid = directorsGrid(service.view())
    const member = service.newRow(grid.tableId)
    service.setCell({ tableId: grid.tableId, member, concept: FIRST, value: 'Asha' })
    service.setCell({ tableId: grid.tableId, member, concept: DESIGNATION, value: 'Managing Director' })
    const board = grid.targets.find((t) => t.elrTitle === 'Disclosures - Directors report' && t.shared.length > 1)!
    const from = { kind: 'rows' as const, tableId: grid.tableId, members: [member] }
    expect(service.fill({ tableId: board.tableId, from })).toEqual({ added: 1, skipped: 0 })
    expect(service.fill({ tableId: board.tableId, from })).toEqual({ added: 0, skipped: 1 })
  })

  it('saves masters to the library and fills an auditor and a group company from it', () => {
    const auditor = auditorGrid(service.view())
    const member = service.newRow(auditor.tableId)
    service.setCell({ tableId: auditor.tableId, member, concept: CATEGORY, value: 'Auditors firm' })
    service.setCell({ tableId: auditor.tableId, member, concept: FIRM, value: 'JKVS & Co.' })
    const saved = service.save({ tableId: auditor.tableId, member })
    expect(saved).toMatchObject({ kind: gridKind(auditor.tableId), title: 'JKVS & Co.', values: { NameOfAuditFirm: 'JKVS & Co.', CategoryOfAuditor: 'Auditors firm' } })
    expect(service.save({ tableId: auditor.tableId, member }).id).toBe(saved.id) // same values: one record

    service.removeRow({ tableId: auditor.tableId, member })
    expect(service.fill({ tableId: auditor.tableId, from: { kind: 'library', ids: [saved.id] } })).toEqual({ added: 1, skipped: 0 })
    expect(auditorGrid(service.view()).rows[0]!.values[FIRM]).toBe('JKVS & Co.')

    const own = service.save({ sectionId: 'company' })
    expect(own.kind).toBe(cardKind('company'))
    const group = company(service.view()).targets.find((t) => t.elrTitle === 'Disclosures - Directors report')!
    expect(service.fill({ tableId: group.tableId, from: { kind: 'library', ids: [own.id] } })).toEqual({ added: 1, skipped: 0 })
    service.forget(own.id)
    expect(service.view().library.map((r) => r.id)).toEqual([saved.id])
  })
})

describe.skipIf(!kbReady || !existsSync(DIXON))('MastersService on Dixon (Ind AS, DGPL’s MCA-accepted instance)', () => {
  it('reads back the auditor and the directors, whose report signatories are already the same people', async () => {
    const { authorities, projects, service } = setup(mkdtempSync(join(tmpdir(), 'xap-masters-dixon-')))
    await new InstanceImportService(authorities, projects, { now: () => new Date() }).importInstance('dixon.xml', readFileSync(DIXON, 'utf8'), 'both')
    const v = service.view()
    const auditor = auditorGrid(v)
    expect(auditor.rows[0]!.values[FIRM]).toBe('JKVS & Co.')
    expect(fieldProblems(auditor.columns.find((c) => c.concept === PAN)!, auditor.rows[0]!.values, auditor.panPairs)).toEqual([])
    const directors = directorsGrid(v)
    const board = directors.targets.find((t) => t.elrTitle === 'Disclosures - Directors report' && t.shared.length > 1)!
    const result = service.fill({ tableId: board.tableId, from: { kind: 'rows', tableId: directors.tableId, members: directors.rows.map((r) => r.member) } })
    expect(result).toEqual({ added: 0, skipped: 2 })
  })
})

describe('KeyValueMasterLibrary', () => {
  it('keeps records in the key/value store, newest first, without duplicates; survives bad data', () => {
    const db = new AppDatabase(':memory:')
    let n = 0
    const lib = new KeyValueMasterLibrary(db, () => `t${n}`, () => `id${++n}`)
    const a = lib.save({ kind: 'k', title: 'A', values: { X: '1' } })
    const b = lib.save({ kind: 'k', title: 'B', values: { X: '2' } })
    expect(lib.save({ kind: 'k', title: 'A again', values: { X: '1' } }).id).toBe(a.id)
    expect(new KeyValueMasterLibrary(db).list().map((r) => r.id)).toEqual([a.id, b.id])
    lib.remove(b.id)
    expect(lib.list().map((r) => r.title)).toEqual(['A again'])
    db.set('masters.library.v1', '{not json')
    expect(lib.list()).toEqual([])
  })
})

describe('live field checks (renderer)', () => {
  const field = (concept: string, extra: Partial<MasterFieldView> = {}): MasterFieldView => ({
    concept, label: concept, dataType: 'string', heading: null, options: null, strictOptions: false, format: null, ...extra,
  })
  const pairs: PanPairView[] = [{ pan: PAN, category: CATEGORY, byCategory: { Individual: { name: 'N', holder: 'P' }, 'Auditors firm': { name: FIRM, holder: 'F' } } }]
  const pan = field(PAN, { format: { name: 'PAN', pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$' } })

  it('reports the format, a value outside a strict list, and a PAN that does not fit the name', () => {
    expect(fieldProblems(pan, { [PAN]: 'AAKF' }, pairs)).toHaveLength(1)
    expect(fieldProblems(pan, { [PAN]: 'AAKFJ6101B', [CATEGORY]: 'Auditors firm', [FIRM]: 'JKVS & Co.' }, pairs)).toEqual([])
    expect(fieldProblems(pan, { [PAN]: 'AAKFJ6101B', [CATEGORY]: 'Individual', N: 'Jatin Kumar' }, pairs)).toHaveLength(2)
    expect(fieldProblems(field(CATEGORY, { options: ['Individual'], strictOptions: true }), { [CATEGORY]: 'Firm' }, [])).toEqual(['Choose one of the listed values.'])
    expect(fieldProblems(field(DESIGNATION, { options: ['Director'] }), { [DESIGNATION]: 'Chairman' }, [])).toEqual([])
  })

  it('knows the name fields that must match the PAN, and titles records by their first values', () => {
    expect([...panNameConcepts(pairs)]).toEqual(['N', FIRM])
    expect(recordTitle({ a: 'Asha', b: ' ', c: 'Rao', d: 'x' }, ['a', 'b', 'c', 'd'])).toBe('Asha · Rao')
    expect(recordTitle({}, ['a'])).toBe('Untitled')
  })
})
