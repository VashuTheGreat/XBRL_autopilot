/**
 * The Form's statement ↔ note matching (docs/14 Step 1): EditorQueryService.form() fills FormRow.note (target + status
 * per year, amounts as displayed) and FormView.difference (the statement's own totals), on a synthetic C&I filing.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { noteTone, type FormView } from '@shared/editor'
import { AppDatabase } from '../electron/main/infra/app-database'
import { DirAutosaveStore } from '../electron/main/infra/dir-autosave-store'
import { EditorQueryService } from '../electron/main/services/editor-query-service'
import { ProjectService } from '../electron/main/services/project-service'
import { authorityCatalog } from './helpers/authority-catalog'
import { kbAuthorityService, kbReady } from './helpers/kb-authorities'

const Q = (local: string) => `in-gaap:${local}`

describe.skipIf(!kbReady)('form(): note ties and the statement difference (C&I)', () => {
  let projects: ProjectService
  let editor: EditorQueryService
  const A = () => projects.project().authority.authority as unknown as { elrs: { uri: string; code: string }[] }
  const uri = (code: string) => A().elrs.find((e) => e.code === code)!.uri
  const set = (local: string, scope: 'CY' | 'PY', v: string) => projects.project().session.setValue(Q(local), scope, v)
  const row = (form: FormView, local: string) => form.rows.find((r) => r.concept === Q(local))!

  beforeEach(async () => {
    projects = new ProjectService({ authority: kbAuthorityService(), recents: new AppDatabase(':memory:'), autosave: new DirAutosaveStore(mkdtempSync(join(tmpdir(), 'xap-ties-'))), appVersion: '0.1.0' })
    editor = new EditorQueryService(projects, () => [], authorityCatalog(projects), () => '2026-11-14')
    await projects.newFiling({
      taxonomy: 'ci-2016', companyName: 'Synthetic Pvt Ltd', cin: 'U72200KA2010PTC123456', reportType: 'Standalone',
      cy: { start: '2025-04-01', end: '2026-03-31' }, py: { start: '2024-04-01', end: '2025-03-31' }, level: 'Lakhs', statementPlaces: 2,
    })
  })

  it('a statement line its note supplies carries the target and the status per year, in lakhs', async () => {
    set('OtherCurrentLiabilities', 'CY', '12.5')
    set('OtherCurrentLiabilities', 'PY', '0')
    const r = row(await editor.form(uri('100100')), 'OtherCurrentLiabilities')
    expect(r.note).toMatchObject({ elrUri: expect.any(String), concept: Q('OtherCurrentLiabilities') })
    expect(r.note!.cy).toEqual({ status: 'note-empty', statement: '12.5', note: null, difference: null })
    expect(r.note!.py).toEqual({ status: 'ok', statement: '0', note: null, difference: null })
    expect(noteTone(r.note)).toBe('bad')
    // a table-backed line names its table (Go to note scrolls there)
    expect(row(await editor.form(uri('100100')), 'ShareCapital').note).toMatchObject({ tableId: expect.any(String) })
    // a line with no note link has none
    expect(row(await editor.form(uri('100100')), 'ShareholdersFunds').note).toBeUndefined()
  })

  it('the statement difference: 0 while the totals add up, the gap and the count when one does not', async () => {
    const BS = uri('100100')
    expect((await editor.form(BS)).difference).toEqual({ cy: '0', py: '0', issues: 0 })
    set('ShareCapital', 'CY', '5')
    set('ReservesAndSurplus', 'CY', '1')
    set('ShareholdersFunds', 'CY', '7') // typed: 1 lakh more than its parts
    expect((await editor.form(BS)).difference).toEqual({ cy: '1', py: '0', issues: 1 })
  })

  it('notes and disclosures have neither', async () => {
    const BS = await editor.form(uri('100100'))
    const note = await editor.form(row(BS, 'OtherCurrentLiabilities').note!.elrUri)
    expect(note.difference).toBeUndefined()
    expect(note.rows.some((r) => r.note)).toBe(false)
  })
})
