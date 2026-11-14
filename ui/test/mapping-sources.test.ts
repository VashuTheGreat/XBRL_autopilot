/**
 * Several sources per fact (docs/14 Step 3, ADR-0015): Add / Replace, remove one source, untag on the last one, exact
 * decimal sums, View details + "Save as footnote", the Form's source chip and the .axbrl round trip. Ind AS
 * knowledge-base authority (no sidecar) and a synthetic workbook — no client data.
 */
import { join } from 'node:path'
import { listFootnotes } from '@xap/engine'
import { sourcesText } from '@shared/editor'
import { beforeEach, describe, expect, it } from 'vitest'
import { EditorQueryService } from '../electron/main/services/editor-query-service'
import { ValidationError } from '../electron/main/services/errors'
import { FilingPropertiesService } from '../electron/main/services/filing-properties-service'
import type { MappingService } from '../electron/main/services/mapping-service'
import type { TaxonomyCatalog } from '../electron/main/services/ports'
import type { ProjectService } from '../electron/main/services/project-service'
import { SourceFootnoteService, sourcesFootnoteText } from '../electron/main/services/source-footnote-service'
import { kbReady } from './helpers/kb-authorities'
import { cell, P, sheet, syntheticIndAsFiling, WORKBOOK } from './helpers/synthetic-ind-as'

const PPE = `${P}PropertyPlantAndEquipment`
const CWIP = `${P}CapitalWorkInProgress`
// Notes: one CY column (B) under a header that names the filing's year end; amounts in lakhs
const NOTES = sheet('Notes', {
  0: { 0: 'Particulars', 1: 'As at 31 March 2026' },
  1: { 0: 'Plant', 1: 0.1 },
  2: { 0: 'Vehicles', 1: 0.2 },
  3: { 0: 'Furniture', 1: 0.05 },
  4: { 0: 'Remarks', 1: 'none' },
})

const BS_URI = 'urn:synthetic:bs'
const catalog: TaxonomyCatalog = {
  elrs: async () => [{ uri: BS_URI, code: '100100', title: 'Balance sheet', group: 'Statements' }],
  elrTree: async () => ({
    uri: BS_URI, code: '100100', title: 'Balance sheet', group: 'Statements',
    tree: [{ qname: PPE, label: 'Property, plant and equipment', abstract: false, type: 'monetaryItemType', periodType: 'instant', balance: 'debit', children: [] }],
  }),
  searchConcepts: async () => [],
}

describe.skipIf(!kbReady)('several sources per fact (Ind AS)', () => {
  let projects: ProjectService
  let mapping: MappingService
  let dir: string
  let value: (concept: string, scope: 'CY' | 'PY') => string | null

  beforeEach(async () => {
    const f = await syntheticIndAsFiling([...WORKBOOK, NOTES])
    ;({ projects, mapping, dir } = f)
    value = (c, s) => f.value(c, s)
  })

  const tagBs = () => mapping.tag({ cell: cell('BS', 'C3'), concept: PPE }) // 1.23 lakhs
  const addNote = (ref: string) => mapping.addSource({ cell: cell('Notes', ref), concept: PPE, scope: 'CY' })

  it('asks only when the fact already has a value from somewhere else', async () => {
    expect(await mapping.conflict({ cell: cell('BS', 'C3'), concept: PPE })).toBeNull()
    const m = await tagBs()
    expect(await mapping.conflict({ cell: cell('BS', 'C3'), concept: PPE })).toBeNull() // its own cell: just re-tag
    const c = await mapping.conflict({ cell: cell('Notes', 'B2'), concept: PPE })
    expect(c).toMatchObject({ concept: PPE, scope: 'CY', value: '1.23', mappingId: m.id, addBlocked: null })
    expect(sourcesText(c!.sources)).toBe('BS!C3')
  })

  it('Add makes the figure the exact sum of its sources; Excel and the Form show all of them', async () => {
    await tagBs()
    const v = await addNote('B2')
    expect(value(PPE, 'CY')).toBe('133000') // 1.23 + 0.10 lakhs
    expect(v.value).toBe('1.33')
    expect(sourcesText(v.sources)).toBe('BS!C3 + Notes!B2')
    expect(v.cell).toEqual(cell('BS', 'C3'))
    const byCell = mapping.byCell()
    expect(byCell.get('workbook-1.xlsx|Notes|B2')?.id).toBe(v.id)
    expect(byCell.get('workbook-1.xlsx|BS|C3')?.id).toBe(v.id)

    const form = await new EditorQueryService(projects, () => mapping.list(), catalog).form(BS_URI)
    const row = form.rows.find((r) => r.concept === PPE)!
    expect(row.cy).toMatchObject({ display: '1.33', source: cell('BS', 'C3'), mappingId: v.id })
    expect(sourcesText(row.cy!.sources!)).toBe('BS!C3 + Notes!B2')
  })

  it('sums with the engine decimal, never floats (0.1 + 0.2), and a reversed sign subtracts', async () => {
    await mapping.tag({ cell: cell('Notes', 'B2'), concept: CWIP, scope: 'CY' })
    await mapping.addSource({ cell: cell('Notes', 'B3'), concept: CWIP, scope: 'CY' })
    expect(value(CWIP, 'CY')).toBe('30000')
    await mapping.addSource({ cell: cell('Notes', 'B4'), concept: CWIP, scope: 'CY', sign: -1 })
    expect(value(CWIP, 'CY')).toBe('25000')
    expect(sourcesText(mapping.list()[0]!.sources)).toBe('Notes!B2 + Notes!B3 − Notes!B4')
  })

  it('Replace files the new cell instead (the old source is untagged)', async () => {
    await tagBs()
    await mapping.tag({ cell: cell('Notes', 'B2'), concept: PPE, scope: 'CY' })
    expect(value(PPE, 'CY')).toBe('10000')
    expect(mapping.list().map((m) => sourcesText(m.sources))).toEqual(['Notes!B2'])
  })

  it('removing one source re-sums the rest; removing the last one untags', async () => {
    const m = await tagBs()
    await addNote('B2')
    const left = await mapping.removeSource(m.id, 0)
    expect(sourcesText(left!.sources)).toBe('Notes!B2')
    expect(left!.cell).toEqual(cell('Notes', 'B2'))
    expect(value(PPE, 'CY')).toBe('10000')
    expect(await mapping.removeSource(m.id, 0)).toBeNull()
    expect(value(PPE, 'CY')).toBeNull()
    expect(mapping.list()).toEqual([])
  })

  it('tagging a source of a sum to another element takes it out of the sum', async () => {
    await tagBs()
    await addNote('B2')
    await mapping.tag({ cell: cell('Notes', 'B2'), concept: CWIP, scope: 'CY' })
    expect(value(PPE, 'CY')).toBe('123000')
    expect(value(CWIP, 'CY')).toBe('10000')
    expect(mapping.list().map((m) => sourcesText(m.sources)).sort()).toEqual(['BS!C3', 'Notes!B2'])
  })

  it('refuses an Add that can’t be summed, saying why', async () => {
    const refused = async (p: Promise<unknown>, re: RegExp) => {
      const err = await p.catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ValidationError)
      expect((err as ValidationError).problems.join(' ')).toMatch(re)
    }
    // a value typed in the Form (no Excel source)
    projects.session().setValue(PPE, 'CY', '2')
    expect((await mapping.conflict({ cell: cell('Notes', 'B2'), concept: PPE, scope: 'CY' }))?.addBlocked).toMatch(/typed or imported/)
    await refused(addNote('B2'), /typed or imported/)
    await tagBs()
    await refused(mapping.addSource({ cell: cell('BS', 'C3'), concept: PPE, scope: 'CY' }), /already part/)
    await mapping.tag({ cell: cell('Notes', 'B3'), concept: CWIP, scope: 'CY' })
    await refused(addNote('B3'), /already tagged/)
    await refused(mapping.addSource({ cell: cell('BS', 'D3'), concept: PPE, scope: 'CY' }), /PY column/)
  })

  it('a sum follows a change of decimal places (re-pulled from every source)', async () => {
    await tagBs()
    await addNote('B2')
    expect(await new FilingPropertiesService(projects, mapping).setStatementPlaces(3)).toEqual([])
    expect(value(PPE, 'CY')).toBe('133500') // 1.235 + 0.100
  })

  it('View details lists every source with its amount and the total; Save as footnote attaches it once', async () => {
    const m = await tagBs()
    await addNote('B2')
    const d = await mapping.details(m.id)
    expect(d.sources.map((s) => [sourcesText([s]), s.value])).toEqual([['BS!C3', '1.23'], ['Notes!B2', '0.1']])
    expect(d.total).toBe('1.33')
    expect(sourcesFootnoteText(d)).toBe('Comprises 1.23 (BS C3) + 0.1 (Notes B2) = 1.33.')

    const footnotes = new SourceFootnoteService(projects, (id) => mapping.details(id))
    const saved = await footnotes.save(m.id)
    expect(await footnotes.save(m.id)).toEqual(saved)
    const filing = projects.session().filing
    expect(listFootnotes(filing)).toMatchObject([{ id: saved.footnoteId, text: saved.text, facts: [{ key: d.factKey }] }])
  })

  it('round-trips the sources through .axbrl', async () => {
    await tagBs()
    await addNote('B2')
    const file = join(dir, 'sum.axbrl')
    await projects.saveAs(file)
    await projects.close()
    await projects.open(file)
    const [m] = mapping.list()
    expect(sourcesText(m!.sources)).toBe('BS!C3 + Notes!B2')
    expect(m!.value).toBe('1.33')
  })
})
