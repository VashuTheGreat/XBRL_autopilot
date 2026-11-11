/**
 * Table tagging in the app (ADR-0013): table facts from single cells, "also reported as" facts that follow their
 * cell, and table blocks (an Excel range mapped to one table). Ind AS knowledge-base authority (no sidecar); a synthetic
 * workbook laid out like DGPL's statements and its PPE schedule (sheet FA) — no client data.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CellModel, CellRef, SheetModel } from '@shared/workbook'
import { AppDatabase } from '../electron/main/infra/app-database'
import { DirAutosaveStore } from '../electron/main/infra/dir-autosave-store'
import { ColumnPeriodService } from '../electron/main/services/column-period-service'
import { ValidationError } from '../electron/main/services/errors'
import { FilingPropertiesService } from '../electron/main/services/filing-properties-service'
import { MappingService } from '../electron/main/services/mapping-service'
import { ProjectService } from '../electron/main/services/project-service'
import { SourceService } from '../electron/main/services/source-service'
import { TableMappingService } from '../electron/main/services/table-mapping-service'
import { kbAuthorityService, kbReady } from './helpers/kb-authorities'

const P = 'ind-as:'
const GROSS = { axis: `${P}CarryingAmountAccumulatedDepreciationAndGrossCarryingAmountAxis`, member: `${P}GrossCarryingAmountMember` }
const COMPUTERS = { axis: `${P}ClassesOfPropertyPlantAndEquipmentAxis`, member: `${P}ComputerEquipmentsMember` }
const OFFICE = { axis: `${P}ClassesOfPropertyPlantAndEquipmentAxis`, member: `${P}OfficeEquipmentMember` }
const SHARES1 = { axis: `${P}ClassesOfEquityShareCapitalAxis`, member: `${P}EquityShares1Member` }
const PPE_TABLE = '400600:DisclosureOfPropertyPlantAndEquipmentTable'

const sheet = (name: string, rows: Record<number, Record<number, string | number>>): SheetModel => {
  const cells: CellModel[] = []
  for (const [r, cols] of Object.entries(rows)) for (const [c, v] of Object.entries(cols)) cells.push({ r: Number(r), c: Number(c), v })
  return { name, rowCount: 40, colCount: 8, cells, merges: [], colWidths: {} } as SheetModel
}
// BS: CY in C, PY in D (header dates). FA: classes in B/C; gross block rows with their period in the label.
const WORKBOOK = [
  sheet('BS', {
    0: { 0: 'Particulars', 2: 'As at 31 March 2026', 3: 'As at 31 March 2025' },
    2: { 0: 'Property, plant and equipment', 2: 1.23456, 3: 0.86 },
    3: { 0: 'Equity share capital', 2: 10, 3: 10 },
  }),
  sheet('FA', {
    4: { 1: 'Computers', 2: 'Office equipment' },
    5: { 0: 'Gross block as at 1 April 2024', 1: 0.73, 2: 0.13 },
    6: { 0: 'Additions', 1: 0, 2: 0 },
    7: { 0: 'Balance as at 31 March 2025', 1: 0.73, 2: 0.13 },
    8: { 0: 'Additions', 1: 0.5 },
    9: { 0: 'Balance as at 31 March 2026', 1: 1.23, 2: 0.13 },
    10: { 0: 'Note', 1: 'see policy' },
  }),
]

describe.skipIf(!kbReady)('table tagging (Ind AS)', () => {
  let projects: ProjectService
  let mapping: MappingService
  let tables: TableMappingService
  let props: FilingPropertiesService
  let dir: string
  const cell = (s: string, ref: string): CellRef => ({ workbook: 'workbook-1.xlsx', sheet: s, ref })
  const value = (concept: string, scope: 'CY' | 'PY', dims: object[] = [], preferredLabel: string | null = null) =>
    (projects.session().getValue(concept, scope, dims as never, preferredLabel) as { value: string } | null)?.value ?? null

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'xap-tables-'))
    projects = new ProjectService({ authority: kbAuthorityService(), recents: new AppDatabase(':memory:'), autosave: new DirAutosaveStore(join(dir, 'a')), appVersion: '0.1.0' })
    const sources = new SourceService(projects, async (source, fileName) => ({ source, fileName, sheets: structuredClone(WORKBOOK) }))
    const columns = new ColumnPeriodService(projects, sources)
    mapping = new MappingService(projects, sources, columns)
    tables = new TableMappingService(projects, sources, columns, mapping)
    props = new FilingPropertiesService(projects, mapping)
    await projects.newFiling({
      taxonomy: 'ind-as-2017', companyName: 'Synthetic Pvt Ltd', cin: 'U72200KA2010PTC123456', reportType: 'Standalone',
      cy: { start: '2025-04-01', end: '2026-03-31' }, py: { start: '2024-04-01', end: '2025-03-31' }, level: 'Lakhs', statementPlaces: 2,
    })
    await sources.importWorkbook('synthetic.xlsx', new Uint8Array([1]))
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
      expect(byCell.get('workbook-1.xlsx|FA|B10')).toMatchObject({ blockId: r.block.id, fact: { tableId: PPE_TABLE, scope: 'CY' } })
      expect(tables.list()).toHaveLength(1)

      // mapping the same range again replaces the block
      const again = await tables.apply(block())
      expect(tables.list().map((b) => b.id)).toEqual([again.block.id])
      expect(mapping.list().filter((m) => m.blockId)).toHaveLength(9)

      tables.remove(again.block.id)
      expect(mapping.list()).toEqual([])
      expect(value(`${P}PropertyPlantAndEquipment`, 'CY', [GROSS, COMPUTERS], 'periodEndLabel')).toBeNull()
    })

    it('refuses rows or columns outside the range, and unknown tables', async () => {
      await expect(tables.plan({ ...block(), cols: [{ c: 6, members: [COMPUTERS] }] })).rejects.toThrow(/inside the selected range/)
      await expect(tables.plan({ ...block(), tableId: 'nope' })).rejects.toThrow(/Unknown table/)
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
