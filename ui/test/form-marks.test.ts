/**
 * The Form's tree marks (docs/14 Step 2): EditorQueryService.form() fills FormRow.marker (E / L / T + tableId),
 * mandatory (empty mandatory years) and tagged, on a synthetic C&I filing; rowTone colours a line from them; conceptUses
 * feeds the "tagged at" marks; the tree's fold helpers.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { conceptUses, rowTone, type FormView, type MappingView } from '@shared/editor'
import { ancestorRows, hiddenRows, parentRows } from '../src/features/xbrl/form-tree'
import { AppDatabase } from '../electron/main/infra/app-database'
import { DirAutosaveStore } from '../electron/main/infra/dir-autosave-store'
import { EditorQueryService } from '../electron/main/services/editor-query-service'
import { ProjectService } from '../electron/main/services/project-service'
import { authorityCatalog } from './helpers/authority-catalog'
import { kbAuthorityService, kbReady } from './helpers/kb-authorities'

const Q = (local: string) => `in-gaap:${local}`
const CELL = { workbook: 'wb.xlsx', sheet: 'Balance Sheet', ref: 'C14' }

describe.skipIf(!kbReady)('form(): tree markers, mandatory and tagged lines (C&I)', () => {
  let projects: ProjectService
  let editor: EditorQueryService
  let mappings: MappingView[] = []
  const A = () => projects.project().authority.authority as unknown as { elrs: { uri: string; code: string; group: string }[] }
  const uri = (code: string) => A().elrs.find((e) => e.code === code)!.uri
  const row = (form: FormView, local: string) => form.rows.find((r) => r.concept === Q(local))!

  beforeEach(async () => {
    mappings = []
    projects = new ProjectService({ authority: kbAuthorityService(), recents: new AppDatabase(':memory:'), autosave: new DirAutosaveStore(mkdtempSync(join(tmpdir(), 'xap-marks-'))), appVersion: '0.1.0' })
    editor = new EditorQueryService(projects, () => mappings, authorityCatalog(projects), () => '2026-11-14')
    await projects.newFiling({
      taxonomy: 'ci-2016', companyName: 'Synthetic Pvt Ltd', cin: 'U72200KA2010PTC123456', reportType: 'Standalone',
      cy: { start: '2025-04-01', end: '2026-03-31' }, py: { start: '2024-04-01', end: '2025-03-31' }, level: 'Lakhs', statementPlaces: 2,
    })
  })

  it('an empty mandatory line is red for each empty year; a value clears that year', async () => {
    const BS = uri('100100')
    const r = row(await editor.form(BS), 'LongTermBorrowings')
    expect(r.mandatory).toMatchObject({ cy: true, py: true, rules: expect.arrayContaining([expect.any(String)]) })
    expect(rowTone(r)).toBe('bad')
    projects.project().session.setValue(Q('LongTermBorrowings'), 'CY', '0')
    expect(row(await editor.form(BS), 'LongTermBorrowings').mandatory).toEqual({ py: true, rules: r.mandatory!.rules })
    projects.project().session.setValue(Q('LongTermBorrowings'), 'PY', '0')
    expect(row(await editor.form(BS), 'LongTermBorrowings').mandatory).toBeUndefined()
    // a line no rule requires carries nothing
    expect(row(await editor.form(BS), 'ShareholdersFunds').mandatory).toBeUndefined()
  })

  it('a line whose value comes from an Excel cell is tagged (green)', async () => {
    const S = projects.project().session
    S.setValue(Q('ShareholdersFunds'), 'CY', '5')
    const key = (S.getValue(Q('ShareholdersFunds'), 'CY') as { key: string }).key
    mappings = [{ id: 'm1', cell: CELL, factKey: key, factKeys: [key], status: 'approved', fact: { concept: Q('ShareholdersFunds'), scope: 'CY', dims: [] } } as unknown as MappingView]
    const BS = await editor.form(uri('100100'))
    expect(row(BS, 'ShareholdersFunds')).toMatchObject({ tagged: true, cy: { source: CELL } })
    expect(rowTone(row(BS, 'ShareholdersFunds'))).toBe('ok')
    expect(row(BS, 'ReservesAndSurplus').tagged).toBeUndefined()
  })

  it('T rows name a table the Form shows; text blocks are E (one ELR) or L (also elsewhere, with the codes)', async () => {
    const forms = await Promise.all(A().elrs.filter((e) => e.group === 'Notes').map((e) => editor.form(e.uri)))
    const tables = forms.flatMap((f) => f.rows.filter((r) => r.marker === 'T').map((r) => ({ r, f })))
    expect(tables.length).toBeGreaterThan(5)
    for (const { r, f } of tables) expect(f.tables.map((t) => t.tableId)).toContain(r.tableId)
    const texts = forms.flatMap((f) => f.rows.filter((r) => r.kind === 'item' && r.dataType === 'textBlock'))
    expect(texts.length).toBeGreaterThan(50)
    expect(texts.every((r) => r.marker === 'E' || r.marker === 'L')).toBe(true)
    const linked = texts.find((r) => r.marker === 'L')!
    expect(linked.linkedElrs!.length).toBeGreaterThan(0)
    expect(texts.find((r) => r.marker === 'E')!.linkedElrs).toBeUndefined()
    // amounts carry no marker
    expect(row(await editor.form(uri('100100')), 'ShareCapital').marker).toBeUndefined()
  })
})

describe('rowTone: one colour for a Form line', () => {
  const tie = (status: 'ok' | 'mismatch' | 'note-empty' | 'no-statement') => ({ status, statement: null, note: null, difference: null })
  it('red beats green: note differs or mandatory empty → bad; note ties or tagged → ok; else none', () => {
    expect(rowTone({})).toBeNull()
    expect(rowTone({ tagged: true })).toBe('ok')
    expect(rowTone({ note: { elrUri: 'n', concept: 'q', cy: tie('ok') } })).toBe('ok')
    expect(rowTone({ tagged: true, mandatory: { py: true, rules: ['R'] } })).toBe('bad')
    expect(rowTone({ tagged: true, note: { elrUri: 'n', concept: 'q', cy: tie('mismatch') } })).toBe('bad')
    expect(rowTone({ note: { elrUri: 'n', concept: 'q', cy: tie('no-statement') } })).toBeNull()
  })
})

describe('conceptUses: where elements are already tagged', () => {
  it('approved tags and their "also reported as" facts, by concept; suggestions are not uses', () => {
    const m = (id: string, concept: string, status: string, also: unknown[] = []) =>
      ({ id, cell: { ...CELL, ref: id }, status, fact: { concept, scope: 'CY', dims: [] }, also }) as unknown as MappingView
    const uses = conceptUses([m('C14', 'q:A', 'approved', [{ concept: 'q:B', scope: 'PY', dims: [] }]), m('C15', 'q:A', 'approved'), m('C16', 'q:C', 'suggested')])
    expect(uses.get('q:A')!.map((u) => u.text)).toEqual(['Balance Sheet!C14 (CY)', 'Balance Sheet!C15 (CY)'])
    expect(uses.get('q:B')!.map((u) => u.text)).toEqual(['Balance Sheet!C14 (PY)'])
    expect(uses.has('q:C')).toBe(false)
  })
})

describe('form tree: expand / collapse', () => {
  //  0 A          1 ·a1       2 ·B        3 ··b1      4 C
  const rows = [{ depth: 0 }, { depth: 1 }, { depth: 1 }, { depth: 2 }, { depth: 0 }]
  it('heads, what a collapsed head hides, and the heads above a row', () => {
    expect(parentRows(rows)).toEqual([0, 2])
    expect(hiddenRows(rows, new Set([2]))).toEqual([false, false, false, true, false])
    expect(hiddenRows(rows, new Set([0, 2]))).toEqual([false, true, true, true, false])
    expect(ancestorRows(rows, 3).sort()).toEqual([0, 2])
    expect(ancestorRows(rows, 4)).toEqual([])
  })
})
