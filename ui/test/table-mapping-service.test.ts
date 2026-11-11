/**
 * Table tagging in the app (ADR-0013): table facts from single cells, "also reported as" facts that follow their
 * cell, and table blocks (an Excel range mapped to one table). Ind AS knowledge-base authority (no sidecar); a synthetic
 * workbook laid out like DGPL's statements and its PPE schedule (sheet FA) — no client data.
 */
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { EditorQueryService } from '../electron/main/services/editor-query-service'
import { ValidationError } from '../electron/main/services/errors'
import { FilingPropertiesService } from '../electron/main/services/filing-properties-service'
import type { MappingService } from '../electron/main/services/mapping-service'
import type { ProjectService } from '../electron/main/services/project-service'
import type { TaxonomyCatalog } from '../electron/main/services/ports'
import { StatementService } from '../electron/main/services/statement-service'
import type { TableMappingService } from '../electron/main/services/table-mapping-service'
import { kbReady } from './helpers/kb-authorities'
import { cell, COMPUTERS, GROSS, OFFICE, P, PPE_NOTE, PPE_TABLE, SHARES1, syntheticIndAsFiling } from './helpers/synthetic-ind-as'

/** The Form's statement list and tree come from the FastAPI routes; the table grids need only the ELR itself. */
const catalog: TaxonomyCatalog = {
  elrs: async () => [{ uri: PPE_NOTE, code: '400600', title: 'Notes - Property, plant and equipment', group: 'Notes' }],
  elrTree: async () => ({ uri: PPE_NOTE, code: '400600', title: 'Notes - Property, plant and equipment', group: 'Notes', tree: [] }),
  searchConcepts: async () => [],
}

describe.skipIf(!kbReady)('table tagging (Ind AS)', () => {
  let projects: ProjectService
  let mapping: MappingService
  let tables: TableMappingService
  let props: FilingPropertiesService
  let dir: string
  let value: Awaited<ReturnType<typeof syntheticIndAsFiling>>['value']

  beforeEach(async () => {
    const f = await syntheticIndAsFiling()
    ;({ projects, mapping, tables, dir, value } = f)
    props = new FilingPropertiesService(projects, mapping)
  })

  describe('also reported as', () => {
    const tagPpe = () => mapping.tag({ cell: cell('BS', 'C3'), concept: `${P}PropertyPlantAndEquipment` })

    it('files the cell’s figure as a table fact too, shown on the cell', async () => {
      const m = await tagPpe()
      const v = await mapping.addAlso({ mappingId: m.id, concept: `${P}PropertyPlantAndEquipment`, dims: [COMPUTERS], preferredLabel: 'periodEndLabel' })
      expect(value(`${P}PropertyPlantAndEquipment`, 'CY')).toBe('123000')
      expect(value(`${P}PropertyPlantAndEquipment`, 'CY', [COMPUTERS])).toBe('123000')
      expect(v.factKeys).toHaveLength(2)
      expect(v.alsoViews[0]).toMatchObject({ conceptLabel: expect.stringMatching(/Property, plant and equipment/i), memberLabels: [expect.stringMatching(/Computer/i)], value: '1.23' })
      expect(v.alsoViews[0]!.fact.tableId).toBe(PPE_TABLE)
    })

    it('follows the cell on every value change: decimal places, re-tag with another sign, change of year', async () => {
      const m = await tagPpe()
      await mapping.addAlso({ mappingId: m.id, concept: `${P}PropertyPlantAndEquipment`, dims: [COMPUTERS] })
      expect(await props.setStatementPlaces(3)).toEqual([])
      expect(value(`${P}PropertyPlantAndEquipment`, 'CY')).toBe('123500')
      expect(value(`${P}PropertyPlantAndEquipment`, 'CY', [COMPUTERS])).toBe('123500')

      const again = await mapping.tag({ cell: cell('BS', 'C3'), concept: `${P}PropertyPlantAndEquipment`, sign: -1 })
      expect(again.also).toHaveLength(1)
      expect(value(`${P}PropertyPlantAndEquipment`, 'CY', [COMPUTERS])).toBe('-123500')

      const moved = await mapping.setScope(again.id, 'PY')
      expect(moved.alsoViews[0]!.fact.scope).toBe('PY')
      expect(value(`${P}PropertyPlantAndEquipment`, 'CY', [COMPUTERS])).toBeNull()
      expect(value(`${P}PropertyPlantAndEquipment`, 'PY', [COMPUTERS])).toBe('-123500')
    })

    it('untag removes the main fact and every also-reported fact', async () => {
      const m = await tagPpe()
      await mapping.addAlso({ mappingId: m.id, concept: `${P}PropertyPlantAndEquipment`, dims: [COMPUTERS] })
      mapping.untag(m.id)
      expect(value(`${P}PropertyPlantAndEquipment`, 'CY')).toBeNull()
      expect(value(`${P}PropertyPlantAndEquipment`, 'CY', [COMPUTERS])).toBeNull()
      expect(mapping.list()).toEqual([])
    })

    it('one fact ← one cell: refuses a fact another cell supplies; removeAlso stops one', async () => {
      const ppe = await tagPpe()
      const sc = await mapping.tag({ cell: cell('BS', 'C4'), concept: `${P}EquityShareCapital` })
      await mapping.addAlso({ mappingId: sc.id, concept: `${P}EquityShareCapital`, dims: [SHARES1] })
      await expect(mapping.addAlso({ mappingId: ppe.id, concept: `${P}EquityShareCapital`, dims: [SHARES1] })).rejects.toThrow(/already comes from BS!C4/)
      await expect(mapping.addAlso({ mappingId: sc.id, concept: `${P}EquityShareCapital`, dims: [SHARES1] })).rejects.toThrow(/already reports/)
      const after = mapping.removeAlso(sc.id, 0)
      expect(after.also).toBeUndefined()
      expect(value(`${P}EquityShareCapital`, 'CY', [SHARES1])).toBeNull()
      expect(value(`${P}EquityShareCapital`, 'CY')).toBe('1000000')
    })
  })

  it('tags one cell as a table fact (its table found from the members); a plain tag of a table-only element says how', async () => {
    const v = await mapping.tag({ cell: cell('FA', 'B9'), concept: `${P}AdditionsOtherThanThroughBusinessCombinationsPropertyPlantAndEquipment`, scope: 'CY', dims: [GROSS, COMPUTERS] })
    expect(v.fact.tableId).toBe(PPE_TABLE)
    expect(value(`${P}AdditionsOtherThanThroughBusinessCombinationsPropertyPlantAndEquipment`, 'CY', [GROSS, COMPUTERS])).toBe('50000')
    // additions to investment property exist only per class (no total column)
    const err = await mapping.tag({ cell: cell('FA', 'B9'), concept: `${P}AdditionsOtherThanThroughBusinessCombinationsInvestmentProperty`, scope: 'CY' }).catch((e) => e)
    expect(err).toBeInstanceOf(ValidationError)
    expect(String(err.problems)).toMatch(/inside a table .*Map as table/)
  })

  describe('table blocks', () => {
    const block = () => ({
      cell: cell('FA', 'A5:C11'),
      tableId: PPE_TABLE,
      rows: [
        { r: 5, concept: `${P}PropertyPlantAndEquipment`, preferredLabel: 'periodStartLabel', scope: 'PY' as const, members: [GROSS] },
        { r: 6, concept: `${P}AdditionsOtherThanThroughBusinessCombinationsPropertyPlantAndEquipment`, scope: 'PY' as const, members: [GROSS] },
        { r: 7, concept: `${P}PropertyPlantAndEquipment`, preferredLabel: 'periodEndLabel', scope: 'PY' as const, members: [GROSS] },
        { r: 8, concept: `${P}AdditionsOtherThanThroughBusinessCombinationsPropertyPlantAndEquipment`, scope: 'CY' as const, members: [GROSS] },
        { r: 9, concept: `${P}PropertyPlantAndEquipment`, preferredLabel: 'periodEndLabel', scope: 'CY' as const, members: [GROSS] },
        { r: 10, concept: `${P}AdditionsOtherThanThroughBusinessCombinationsPropertyPlantAndEquipment`, scope: 'CY' as const, members: [GROSS] },
      ],
      cols: [{ c: 1, members: [COMPUTERS] }, { c: 2, members: [OFFICE] }],
    })

    it('previews every filled cell with its value and problems; blank cells give nothing', async () => {
      const plan = await tables.plan(block())
      expect(plan.tableTitle).toMatch(/property, plant and equipment/i)
      expect(plan.cells.map((c) => c.cell.ref)).toEqual(['B6', 'C6', 'B7', 'C7', 'B8', 'C8', 'B9', 'B10', 'C10', 'B11'])
      expect(plan.cells.find((c) => c.cell.ref === 'B6')).toMatchObject({ value: '0.73', scope: 'PY', preferredLabel: 'periodStartLabel', problems: [] })
      expect(plan.cells.find((c) => c.cell.ref === 'B11')!.problems.join(' ')).toMatch(/not a number|already this fact/)
      expect(plan.blocked).toBe(1)
    })

    it('tags the ready cells as one block: facts in the filing, each cell linked, removal as a unit', async () => {
      const r = await tables.apply(block())
      expect(r.tagged).toBe(9)
      expect(r.problems.map((x) => x.cell.ref)).toEqual(['B11'])
      expect(value(`${P}PropertyPlantAndEquipment`, 'PY', [GROSS, COMPUTERS], 'periodStartLabel')).toBe('73000')
      expect(value(`${P}PropertyPlantAndEquipment`, 'CY', [GROSS, COMPUTERS], 'periodEndLabel')).toBe('123000')
      const byCell = mapping.byCell()
      expect(byCell.get('workbook-1.xlsx|FA|B10')).toMatchObject({ blockId: r.block.id, fact: { tableId: PPE_TABLE, scope: 'CY' }, elrUris: [PPE_NOTE] })
      expect(tables.list()).toHaveLength(1)

      // mapping the same range again replaces the block
      const again = await tables.apply(block())
      expect(tables.list().map((b) => b.id)).toEqual([again.block.id])
      expect(mapping.list().filter((m) => m.blockId)).toHaveLength(9)

      tables.remove(again.block.id)
      expect(mapping.list()).toEqual([])
      expect(value(`${P}PropertyPlantAndEquipment`, 'CY', [GROSS, COMPUTERS], 'periodEndLabel')).toBeNull()
    })

    it('one cell, more facts: a row’s other line items and a column’s totals are filed as "also" facts; a row reports only its own columns', async () => {
      const CAT = { axis: `${P}CategoriesOfFinancialAssetsAxis`, member: `${P}FinancialAssetsAtAmortisedCostCategoryMember` }
      const CLS = { axis: `${P}ClassesOfFinancialAssetsAxis`, member: `${P}TradeReceivablesMember` }
      const assets = {
        cell: cell('FA', 'A6:C8'),
        tableId: '611100a:DisclosureOfFinancialAssetsTable',
        rows: [{ r: 5, concept: `${P}FinancialAssets`, members: [CLS], cols: [1], also: [{ concept: `${P}FinancialAssetsAtFairValue` }] }],
        cols: [{ c: 1, members: [CAT], scope: 'CY' as const, alsoTotal: [CAT.axis] }, { c: 2, members: [CAT], scope: 'PY' as const }],
      }
      const plan = await tables.plan(assets)
      expect(plan.cells.map((c) => c.cell.ref)).toEqual(['B6']) // C6 is not the row's column
      expect(plan.cells[0]!.also.map((a) => a.conceptLabel)).toHaveLength(3)
      const r = await tables.apply(assets)
      expect(r).toMatchObject({ tagged: 1, problems: [] })
      for (const [concept, dims] of [[`${P}FinancialAssets`, [CAT, CLS]], [`${P}FinancialAssets`, [CLS]], [`${P}FinancialAssetsAtFairValue`, [CAT, CLS]], [`${P}FinancialAssetsAtFairValue`, [CLS]]] as const) {
        expect(value(concept, 'CY', [...dims])).toBe('73000')
      }
      expect(value(`${P}FinancialAssets`, 'PY', [CAT, CLS])).toBeNull()
      expect(mapping.list()[0]!.also).toHaveLength(3)
      tables.remove(r.block.id)
      expect(value(`${P}FinancialAssetsAtFairValue`, 'CY', [CLS])).toBeNull()
    })

    it('refuses rows or columns outside the range, and unknown tables', async () => {
      await expect(tables.plan({ ...block(), cols: [{ c: 6, members: [COMPUTERS] }] })).rejects.toThrow(/inside the selected range/)
      await expect(tables.plan({ ...block(), tableId: 'nope' })).rejects.toThrow(/Unknown table/)
    })

    it('the Form shows the table: a column per class and year, each value with its source cell (also-reported marked)', async () => {
      await tables.apply(block())
      const m = await mapping.tag({ cell: cell('BS', 'C3'), concept: `${P}PropertyPlantAndEquipment` })
      await mapping.addAlso({ mappingId: m.id, concept: `${P}PropertyPlantAndEquipment`, dims: [COMPUTERS], preferredLabel: 'periodEndLabel' })
      const form = await new EditorQueryService(projects, () => mapping.list(), catalog).form(PPE_NOTE)
      const t = form.tables.find((x) => x.tableId === PPE_TABLE)!
      expect(t.closed).toBe(false)
      const col = (label: RegExp, scope: string) => t.columns.find((c) => label.test(c.label) && c.scope === scope)!
      const grossComputersCy = col(/Computer.*Gross|Gross.*Computer/, 'CY')
      const additions = t.rows.find((r) => r.concept === `${P}AdditionsOtherThanThroughBusinessCombinationsPropertyPlantAndEquipment`)!
      expect(additions.cells[grossComputersCy.key]).toMatchObject({ display: '0.5', source: { sheet: 'FA', ref: 'B9' } })
      const closing = t.rows.find((r) => r.concept === `${P}PropertyPlantAndEquipment` && r.preferredLabel === 'periodEndLabel')!
      expect(closing.cells[col(/^Computer equipments$/i, 'CY').key]).toMatchObject({ display: '1.23', source: { sheet: 'BS', ref: 'C3' }, also: true })
    })

    it('Table zeros → 0 fills what the rules require in columns that have a value, and lists it', async () => {
      await tables.apply(block())
      const filled = new StatementService(projects).fillTableZeros(PPE_NOTE)
      expect(filled.length).toBeGreaterThan(0)
      expect(new Set(filled.map((z) => z.concept))).toContain(`${P}ChangesInPropertyPlantAndEquipment`)
      expect(filled.every((z) => z.tableId === PPE_TABLE && z.memberLabels.length > 0)).toBe(true)
      expect(new StatementService(projects).fillTableZeros(PPE_NOTE)).toEqual([]) // nothing left
    })

    it('lists the taxonomy’s tables and a table’s rows and members for the picker', () => {
      const all = tables.tables()
      expect(all.length).toBeGreaterThan(150)
      expect(all.find((t) => t.id === PPE_TABLE)).toMatchObject({ elrCode: '400600', concepts: expect.arrayContaining([`${P}PropertyPlantAndEquipment`]) })
      const s = tables.structure(PPE_TABLE)
      expect(s.lineItems.filter((l) => l.concept === `${P}PropertyPlantAndEquipment`).map((l) => l.preferredLabel)).toEqual(['periodStartLabel', 'periodEndLabel'])
      expect(s.axes.find((a) => a.axis === COMPUTERS.axis)!.members.some((m) => m.member === COMPUTERS.member)).toBe(true)
    })

    it('blocks and also-reported facts survive save → reopen', async () => {
      await tables.apply(block())
      const m = await mapping.tag({ cell: cell('BS', 'C3'), concept: `${P}PropertyPlantAndEquipment` })
      await mapping.addAlso({ mappingId: m.id, concept: `${P}PropertyPlantAndEquipment`, dims: [COMPUTERS] })
      const path = join(dir, 'f.axbrl')
      await projects.saveAs(path)
      await projects.close()
      await projects.open(path)
      expect(tables.list()).toHaveLength(1)
      const reopened = mapping.list().find((x) => x.cell.ref === 'C3')!
      expect(reopened.alsoViews[0]!.value).toBe('1.23')
      expect(value(`${P}PropertyPlantAndEquipment`, 'PY', [GROSS, OFFICE], 'periodStartLabel')).toBe('13000')
    })
  })
})
