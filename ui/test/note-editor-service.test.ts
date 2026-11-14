/**
 * docs/14 Step 6: NoteEditorService (open a text element's CY value, the live check, Auto format, save as MCA markup /
 * plain text with the parent-text-block warning, refusals), the .docx conversion through mammoth on a synthetic Word
 * file, the validation hint, and the editor's layout hints.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { htmlGuidelineIssues } from '@xap/engine'
import { layoutHints } from '@shared/notes'
import { AppDatabase } from '../electron/main/infra/app-database'
import { DirAutosaveStore } from '../electron/main/infra/dir-autosave-store'
import { MammothDocxConverter } from '../electron/main/infra/mammoth-docx-converter'
import { ValidationError } from '../electron/main/services/errors'
import { NoteEditorService } from '../electron/main/services/note-editor-service'
import { ProjectService } from '../electron/main/services/project-service'
import { ValidationService } from '../electron/main/services/validation-service'
import { kbAuthorityService, kbReady } from './helpers/kb-authorities'

const DOCX = resolve(__dirname, 'fixtures/synthetic-directors-report.docx')
const PARENT = 'in-ca:DisclosureInAuditorsReportExplanatoryTextBlock'
const REMARKS = 'in-ca:AuditorsQualificationsReservationsOrAdverseRemarksInAuditorsReport'
const WORD_PASTE = `<p class=MsoNormal style='font-family:Arial'><b>Opinion<o:p></o:p></b></p><p class=MsoNormal>&nbsp;</p>
<table class=MsoTableGrid border=1><col width=90><tr><td style='border:1pt'>Clause</td><td>Remark</td><td></td></tr><tr><td colspan=3>None</td></tr></table>`

describe.skipIf(!kbReady)('NoteEditorService (C&I)', () => {
  let projects: ProjectService
  let notes: NoteEditorService

  beforeEach(async () => {
    projects = new ProjectService({ authority: kbAuthorityService(), recents: new AppDatabase(':memory:'), autosave: new DirAutosaveStore(mkdtempSync(join(tmpdir(), 'xap-notes-'))), appVersion: '0.1.0' })
    notes = new NoteEditorService(projects, new MammothDocxConverter())
    await projects.newFiling({
      taxonomy: 'ci-2016', companyName: 'Synthetic Pvt Ltd', cin: 'U72200KA2010PTC123456', reportType: 'Standalone',
      cy: { start: '2025-04-01', end: '2026-03-31' }, py: { start: '2024-04-01', end: '2025-03-31' }, level: 'Lakhs', statementPlaces: 2,
    })
  })

  it('opens a text block (rich) and a text item (plain) with the parent it sits under', () => {
    expect(notes.open(PARENT)).toMatchObject({ dataType: 'textBlock', html: '', parent: null })
    expect(notes.open(REMARKS)).toMatchObject({ dataType: 'string', parent: { concept: PARENT, empty: true } })
  })

  it('saves pasted Word content as MCA markup, CY only, and reopens it for editing', () => {
    expect(notes.save({ concept: PARENT, html: WORD_PASTE })).toEqual({ warnings: [] })
    const saved = projects.session().getValue(PARENT, 'CY')!.value
    expect(htmlGuidelineIssues(saved)).toEqual([])
    expect(saved).toContain('<table')
    expect(projects.session().getValue(PARENT, 'PY')).toBeNull()
    expect(notes.open(PARENT).html).toContain('Opinion')
    notes.save({ concept: PARENT, html: '' })
    expect(projects.session().getValue(PARENT, 'CY')).toBeNull()
  })

  it('warns when a sub-item is saved while its parent text block is empty; the hint shows in validation', () => {
    expect(notes.save({ concept: REMARKS, html: '<p>Qualified on <b>inventory</b>.</p>' }).warnings[0]).toMatch(/parent text block .* is still empty/)
    expect(projects.session().getValue(REMARKS, 'CY')!.value).toBe('Qualified on inventory.')
    const hint = new ValidationService(projects, () => []).run().problems.find((p) => p.message.includes('parent text block'))
    expect(hint?.severity).toBe('info')
    notes.save({ concept: PARENT, html: '<p>Report</p>' })
    expect(notes.save({ concept: REMARKS, html: 'Qualified.' }).warnings).toEqual([])
  })

  it('refuses amounts, unknown elements and table-only elements', () => {
    expect(() => notes.open('in-gaap:ShareCapital')).toThrow(/an amount/)
    expect(() => notes.open('x:Nope')).toThrow(ValidationError)
    expect(() => notes.open('in-ca:NameOfAuditFirm')).toThrow(/inside a table/)
  })

  it('checks and Auto-formats without a filing write', () => {
    expect(notes.check({ html: WORD_PASTE, dataType: 'textBlock' })).toMatchObject({ renders: true, errors: [] })
    const formatted = notes.autoFormat(WORD_PASTE)
    expect(formatted.stats.columns).toBe(1)
    expect(formatted.html).toContain('None')
  })

  it('opens a Word document as blocks: heading, paragraphs, the table (merged row kept), images dropped', async () => {
    const doc = await notes.openDocx('report.docx', new Uint8Array(readFileSync(DOCX)))
    expect(doc.fileName).toBe('report.docx')
    expect(doc.blocks[0]).toMatch(/Directors report/)
    const table = doc.blocks.find((b) => b.startsWith('<table'))!
    expect(table).toContain('Number of board meetings')
    expect(table).toContain('Merged note across the columns')
    expect(doc.blocks.some((b) => b.includes('Signed for and on behalf of the Board.'))).toBe(true)
    expect(notes.save({ concept: PARENT, html: doc.blocks.join('') }).warnings).toEqual([])
    expect(htmlGuidelineIssues(projects.session().getValue(PARENT, 'CY')!.value)).toEqual([])
    await expect(notes.openDocx('not.docx', new Uint8Array([1, 2, 3]))).rejects.toThrow(/could not be read as a Word document/)
  })
})

describe('layout hints', () => {
  it('says what prints untidily, and nothing for clean content', () => {
    expect(layoutHints({ blank: 2, shaded: 0, largeHeadings: 1, columns: 0, rows: 0, wideTables: 0 })).toEqual(['2 empty paragraphs (large gaps in the PDF)', '1 large headings'])
    expect(layoutHints({ blank: 0, shaded: 0, largeHeadings: 0, columns: 0, rows: 0, wideTables: 0 })).toEqual([])
  })
})
