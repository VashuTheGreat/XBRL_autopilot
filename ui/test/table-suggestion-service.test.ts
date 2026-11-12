/**
 * Table suggestions in the app (ADR-0013, Phase 11 step 3b): auto-tagging's table blocks and "also reported as" facts
 * are stored as suggestions and tag nothing until accepted. Block accept (as suggested, or edited), reject, re-run;
 * also accept / reject one by one and never in "Accept all"; save → reopen. Synthetic Ind AS workbook, a fake
 * suggester in the sidecar's response shape (the real sidecar is covered by the E2E on DGPL).
 */
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { AutoTagService } from '../electron/main/services/auto-tag-service'
import { ValidationError } from '../electron/main/services/errors'
import type { MappingService } from '../electron/main/services/mapping-service'
import type { MappingSuggester, SuggestResponse, Suggestion, SuggestedBlock } from '../electron/main/services/ports'
import type { ProjectService } from '../electron/main/services/project-service'
import type { TableMappingService } from '../electron/main/services/table-mapping-service'
import { TableSuggestionService } from '../electron/main/services/table-suggestion-service'
import { kbReady } from './helpers/kb-authorities'
import { cell, COMPUTERS, GROSS, OFFICE, P, PPE_TABLE, SHARES1, SHARES_TABLE, syntheticIndAsFiling } from './helpers/synthetic-ind-as'

const NO_MEMORY = { recall: () => [], remember: () => {} }

const statement = (ref: string, concept: string, also: Suggestion['also'] = undefined): Suggestion => ({
  cell: { sheet: 'BS', ref },
  label: 'x',
  concept,
  conceptLabel: concept,
  scope: 'CY',
  sign: 1,
  confidence: 0.95,
  origin: 'exact',
  rationale: 'label',
  needsReview: false,
  alternatives: [],
  ...(also ? { also } : {}),
})

const PPE_BLOCK: SuggestedBlock = {
  sheet: 'FA',
  range: 'A5:C10',
  tableId: PPE_TABLE,
  tableTitle: 'Disclosure of property, plant and equipment',
  confidence: 0.78,
  rows: [
    { r: 5, concept: `${P}PropertyPlantAndEquipment`, preferredLabel: 'periodStartLabel', scope: 'PY', members: [GROSS] },
    { r: 6, concept: `${P}AdditionsOtherThanThroughBusinessCombinationsPropertyPlantAndEquipment`, preferredLabel: null, scope: 'PY', members: [GROSS] },
    { r: 7, concept: `${P}PropertyPlantAndEquipment`, preferredLabel: 'periodEndLabel', scope: 'PY', members: [GROSS] },
    { r: 8, concept: `${P}AdditionsOtherThanThroughBusinessCombinationsPropertyPlantAndEquipment`, preferredLabel: null, scope: 'CY', members: [GROSS] },
    { r: 9, concept: `${P}PropertyPlantAndEquipment`, preferredLabel: 'periodEndLabel', scope: 'CY', members: [GROSS] },
  ],
  cols: [{ c: 1, members: [COMPUTERS] }, { c: 2, members: [OFFICE] }],
  cells: Array.from({ length: 9 }, (_, i) => ({ ref: `X${i}` })),
}

class FakeSuggester implements MappingSuggester {
  blocks: SuggestedBlock[] = [PPE_BLOCK]
  async suggest(): Promise<SuggestResponse> {
    return {
      layout: [{ sheet: 'BS', kind: 'balance_sheet', rows: 2, note: null }],
      suggestions: [
        statement('C3', `${P}PropertyPlantAndEquipment`),
        statement('C4', `${P}EquityShareCapital`, [{ concept: `${P}EquityShareCapital`, tableId: SHARES_TABLE, preferredLabel: 'periodEndLabel', dims: [SHARES1], confidence: 0.7, reason: 'one class' }]),
      ],
      blocks: structuredClone(this.blocks),
      llmUsed: false,
    }
  }
}

describe.skipIf(!kbReady)('table suggestions in the app (Ind AS)', () => {
  let projects: ProjectService
  let mapping: MappingService
  let tables: TableMappingService
  let suggestions: TableSuggestionService
  let suggester: FakeSuggester
  let autoTag: AutoTagService
  let dir: string
  let value: Awaited<ReturnType<typeof syntheticIndAsFiling>>['value']
  const at = (ref: string) => mapping.list().find((m) => m.cell.sheet === 'BS' && m.cell.ref === ref)!
  const open = () => suggestions.list().filter((s) => s.status === 'suggested')

  beforeEach(async () => {
    const f = await syntheticIndAsFiling()
    ;({ projects, mapping, tables, dir, value } = f)
    suggestions = new TableSuggestionService(projects, tables)
    suggester = new FakeSuggester()
    autoTag = new AutoTagService(projects, f.sources, mapping, suggester, NO_MEMORY, suggestions)
  })

  it('a run stores block and "also" suggestions and files nothing', async () => {
    const facts = () => (projects.project().session.filing as unknown as { facts: Map<string, unknown> }).facts.size
    const before = facts() // the new filing's own facts (company, periods)
    const summary = await autoTag.run()
    expect(summary).toMatchObject({ suggested: 2, blocks: 1 })
    expect(facts()).toBe(before)
    expect(open()).toMatchObject([{ cell: cell('FA', 'A5:C10'), tableId: PPE_TABLE, confidence: 0.78, cellCount: 9, status: 'suggested' }])
    expect(at('C4').alsoSuggested).toEqual([{ concept: `${P}EquityShareCapital`, scope: 'CY', dims: [SHARES1], tableId: SHARES_TABLE, preferredLabel: 'periodEndLabel', confidence: 0.7, reason: 'one class' }])
    expect(at('C4').alsoSuggestedViews[0]).toMatchObject({ memberLabels: [expect.stringMatching(/Equity shares 1/i)] })
  })

  it('accepting a block tags its cells (origin table, its confidence) and closes the suggestion', async () => {
    await autoTag.run()
    const r = await suggestions.accept(open()[0]!.id)
    expect(r.tagged).toBe(9)
    expect(value(`${P}PropertyPlantAndEquipment`, 'CY', [GROSS, COMPUTERS], 'periodEndLabel')).toBe('123000')
    const tagged = mapping.list().filter((m) => m.blockId === r.block.id)
    expect(tagged).toHaveLength(9)
    expect(tagged.every((m) => m.origin === 'table' && m.confidence === 0.78)).toBe(true)
    expect(r.block).toMatchObject({ origin: 'table', confidence: 0.78 })
    expect(suggestions.list()).toEqual([])
    // a range that holds a table block is not suggested again
    await autoTag.run()
    expect(open()).toEqual([])
  })

  it('accepting an edited block (Map as table, prefilled) is a manual choice', async () => {
    await autoTag.run()
    const s = open()[0]!
    const r = await suggestions.accept(s.id, { cell: s.cell, tableId: s.tableId, rows: s.rows.slice(4), cols: s.cols })
    expect(r.tagged).toBe(2)
    expect(r.block).toMatchObject({ origin: 'manual', confidence: null })
    expect(suggestions.list()).toEqual([])
  })

  it('a rejected block is not suggested again; one that tags nothing stays open and says why', async () => {
    await autoTag.run()
    const id = open()[0]!.id
    expect(suggestions.reject(id).status).toBe('rejected')
    await expect(suggestions.accept(id)).rejects.toThrow(ValidationError)
    await autoTag.run()
    expect(open()).toEqual([])
    expect(suggestions.list()).toHaveLength(1)

    // a block whose cells have no member: nothing can be tagged
    suggester.blocks = [{ ...PPE_BLOCK, range: 'A5:C6', rows: [{ ...PPE_BLOCK.rows[0]!, members: [] }], cols: [{ c: 1, members: [] }] }]
    await autoTag.run()
    const bare = open()[0]!
    const err = await suggestions.accept(bare.id).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ValidationError)
    expect(String((err as ValidationError).problems)).toMatch(/no member/)
    expect(open().map((s) => s.id)).toEqual([bare.id])
    expect(tables.list()).toEqual([])
  })

  it('"also" suggestions: kept on accept, never in Accept all, then accepted or rejected one by one', async () => {
    await autoTag.run()
    const all = await autoTag.acceptAll(0.9)
    expect(all).toMatchObject({ accepted: 2, blocks: 0, cells: 0, problems: [] }) // the 0.78 block stays open
    expect(value(`${P}EquityShareCapital`, 'CY')).toBe('1000000')
    expect(value(`${P}EquityShareCapital`, 'CY', [SHARES1])).toBeNull()
    expect(at('C4').alsoSuggested).toHaveLength(1)

    const accepted = await mapping.acceptAlso(at('C4').id, 0)
    expect(accepted.alsoSuggested).toBeUndefined()
    expect(accepted.alsoViews).toMatchObject([{ fact: { concept: `${P}EquityShareCapital`, dims: [SHARES1] }, value: '10' }])
    expect(value(`${P}EquityShareCapital`, 'CY', [SHARES1])).toBe('1000000')
    expect(() => mapping.rejectAlso(at('C4').id, 0)).toThrow(/no longer open/)

    // Accept all at a lower bar takes the block too, still not the "also" items
    await autoTag.run()
    expect(await autoTag.acceptAll(0.7)).toMatchObject({ blocks: 1, cells: 9 })
  })

  it('an "also" suggestion waits for its cell’s tag; rejecting drops it; a change of year moves it', async () => {
    await autoTag.run()
    await expect(mapping.acceptAlso(at('C4').id, 0)).rejects.toThrow(/own tag first/)
    await mapping.setScope(at('C4').id, 'PY')
    expect(at('C4').alsoSuggested![0]!.scope).toBe('PY')
    const tagged = await autoTag.accept(at('C4').id)
    expect(tagged.alsoSuggested![0]!.scope).toBe('PY')
    expect(mapping.rejectAlso(tagged.id, 0).alsoSuggested).toBeUndefined()
    expect(value(`${P}EquityShareCapital`, 'PY', [SHARES1])).toBeNull()
  })

  it('block and "also" suggestions survive save → reopen', async () => {
    await autoTag.run()
    const path = join(dir, 's.axbrl')
    await projects.saveAs(path)
    await projects.close()
    await projects.open(path)
    expect(open()).toHaveLength(1)
    expect(at('C4').alsoSuggested).toHaveLength(1)
  })
})
