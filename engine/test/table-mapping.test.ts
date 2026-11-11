/**
 * Table blocks (ADR-0013): an Excel range mapped to one taxonomy table becomes one fact per non-empty cell. Tested on
 * both filing taxonomies with synthetic blocks laid out like real schedules: the DGPL-style PPE roll-forward (classes in
 * the columns; the carrying-amount group, the movement and the period in the rows) for Ind AS, and the C&I tangible
 * assets table. Planned facts must be fileable through Session.setTableValue.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assembleAuthority, Authority, NO_MEMBER, planTableBlock, Session, tableOfFact, UnknownTableError, type TableBlockSpec } from '../src/index'

const KB = (f: string) => new URL(`../../knowledge_base/${f}`, import.meta.url)
const json = (u: URL) => JSON.parse(readFileSync(u, 'utf8'))
const load = (kb: string) => new Authority(assembleAuthority(json(KB(`${kb}_engine_authority.json`)), json(KB(`${kb}_engine_rules.json`))))
const META = {
  name: 'Z Pvt Ltd', cin: 'U72200KA2010PTC123456', reportType: 'Standalone', level: 'Lakhs', statementPlaces: 2, displayPlaces: 7,
  periods: { cy: { start: '2025-04-01', end: '2026-03-31' }, py: { start: '2024-04-01', end: '2025-03-31' } },
}
const all = () => true
const byColumn = (m: Record<number, 'CY' | 'PY'>) => (c: number) => m[c] ?? null

describe('Ind AS: a PPE roll-forward block (DGPL sheet FA layout)', () => {
  const A = load('ind_as')
  const T = '400600:DisclosureOfPropertyPlantAndEquipmentTable'
  const P = 'ind-as:'
  const GROSS = [{ axis: `${P}CarryingAmountAccumulatedDepreciationAndGrossCarryingAmountAxis`, member: `${P}GrossCarryingAmountMember` }]
  const ACC = [{ axis: `${P}CarryingAmountAccumulatedDepreciationAndGrossCarryingAmountAxis`, member: `${P}AccumulatedDepreciationAndImpairmentMember` }]
  const CLASS = (m: string) => [{ axis: `${P}ClassesOfPropertyPlantAndEquipmentAxis`, member: `${P}${m}` }]
  // rows 10–17 gross block (PY opening, PY additions, PY closing = CY opening, CY additions, CY closing), 21–28 depreciation
  const spec: TableBlockSpec = {
    tableId: T,
    rows: [
      { r: 10, concept: `${P}PropertyPlantAndEquipment`, preferredLabel: 'periodStartLabel', scope: 'PY', members: GROSS },
      { r: 11, concept: `${P}AdditionsOtherThanThroughBusinessCombinationsPropertyPlantAndEquipment`, scope: 'PY', members: GROSS },
      { r: 13, concept: `${P}PropertyPlantAndEquipment`, preferredLabel: 'periodEndLabel', scope: 'PY', members: GROSS },
      { r: 15, concept: `${P}AdditionsOtherThanThroughBusinessCombinationsPropertyPlantAndEquipment`, scope: 'CY', members: GROSS },
      { r: 17, concept: `${P}PropertyPlantAndEquipment`, preferredLabel: 'periodEndLabel', scope: 'CY', members: GROSS },
      { r: 26, concept: `${P}DepreciationPropertyPlantAndEquipment`, scope: 'CY', members: ACC },
    ],
    cols: [{ c: 2, members: CLASS('FurnitureAndFixturesMember') }, { c: 3, members: CLASS('ComputerEquipmentsMember') }],
  }

  it('plans one fact per filled cell, period and members from the rows, classes from the columns', () => {
    const plan = planTableBlock(A, spec, { hasValue: (r, c) => !(r === 26 && c === 2), columnScope: () => null })
    expect(plan).toHaveLength(11) // 6 rows × 2 columns, one blank cell
    expect(plan.every((p) => p.problems.length === 0)).toBe(true)
    const opening = plan.find((p) => p.r === 10 && p.c === 3)!
    expect(opening).toMatchObject({ concept: `${P}PropertyPlantAndEquipment`, preferredLabel: 'periodStartLabel', scope: 'PY' })
    expect(opening.dims.map((d) => d.member).sort()).toEqual([`${P}ComputerEquipmentsMember`, `${P}GrossCarryingAmountMember`])
    // "Charge for the year" is the table's negated-total depreciation row: the fact keeps the table's role
    expect(plan.find((p) => p.r === 26)!.preferredLabel).toBe('negatedTotalLabel')
  })

  it('the planned facts file through the session, opening balances at the previous year start', () => {
    const S = new Session(A)
    S.setMeta(META)
    for (const p of planTableBlock(A, spec, { hasValue: all, columnScope: () => null })) {
      S.setTableValue(p.tableId, p.scope!, p.dims, p.concept, '1.5', { preferredLabel: p.preferredLabel })
    }
    const opening = S.getValue(`${P}PropertyPlantAndEquipment`, 'PY', [...GROSS, ...CLASS('ComputerEquipmentsMember')], 'periodStartLabel') as { period: { date?: string } }
    expect(JSON.stringify(opening.period)).toContain('2024-03-31')
  })

  it('says what is wrong, per cell', () => {
    const bad: TableBlockSpec = {
      tableId: T,
      rows: [
        { r: 1, concept: 'ind-as:Revenue', members: GROSS },
        { r: 2, concept: `${P}AdditionsOtherThanThroughBusinessCombinationsPropertyPlantAndEquipment`, members: [{ axis: GROSS[0]!.axis, member: `${P}ComputerEquipmentsMember` }] },
        { r: 3, concept: `${P}DepreciationPropertyPlantAndEquipment`, members: ACC },
        { r: 4, concept: `${P}DisposalsPropertyPlantAndEquipment`, members: GROSS, preferredLabel: 'periodStartLabel' },
      ],
      cols: [{ c: 2, members: [...CLASS('ComputerEquipmentsMember'), ...ACC] }, { c: 3, members: CLASS('OfficeEquipmentMember') }],
    }
    const plan = planTableBlock(A, bad, { hasValue: all, columnScope: byColumn({ 2: 'CY' }) })
    const at = (r: number, c: number) => plan.find((p) => p.r === r && p.c === c)!.problems.join(' ')
    expect(at(1, 2)).toMatch(/not a line item/)
    expect(at(2, 3)).toMatch(/not a member of|not usable|Unknown member|can't be reported/)
    expect(at(3, 3)).toMatch(/period of this column is unknown/)
    expect(at(3, 2)).toBe('') // ACC from the row and the column agree
    expect(at(1, 3)).toMatch(/not a line item/)
    expect(at(4, 2)).toMatch(/has no opening balance row for/)
    const conflict = planTableBlock(A, { tableId: T, rows: [{ r: 5, concept: `${P}AdditionsOtherThanThroughBusinessCombinationsPropertyPlantAndEquipment`, members: GROSS }], cols: [{ c: 2, members: ACC }] }, { hasValue: all, columnScope: () => 'CY' })
    expect(conflict[0]!.problems.join(' ')).toMatch(/different members/)
  })

  it('a cell with no member at all is a statement figure, not a table value (a Total column’s net row)', () => {
    const total: TableBlockSpec = {
      tableId: T,
      rows: [
        { r: 17, concept: `${P}PropertyPlantAndEquipment`, preferredLabel: 'periodEndLabel', scope: 'CY', members: GROSS },
        { r: 30, concept: `${P}PropertyPlantAndEquipment`, preferredLabel: 'periodEndLabel', scope: 'CY' },
      ],
      cols: [{ c: 6, members: [] }],
    }
    const plan = planTableBlock(A, total, { hasValue: all, columnScope: () => null })
    expect(plan.find((p) => p.r === 17)!.problems).toEqual([])
    expect(plan.find((p) => p.r === 30)!.problems).toEqual([NO_MEMBER])
  })

  it('refuses two cells that would be the same fact', () => {
    const dup: TableBlockSpec = {
      tableId: T,
      rows: [11, 12].map((r) => ({ r, concept: `${P}AdditionsOtherThanThroughBusinessCombinationsPropertyPlantAndEquipment`, scope: 'CY' as const, members: GROSS })),
      cols: [{ c: 2, members: CLASS('ComputerEquipmentsMember') }],
    }
    const plan = planTableBlock(A, dup, { hasValue: all, columnScope: () => null })
    expect(plan[0]!.problems).toEqual([])
    expect(plan[1]!.problems.join(' ')).toMatch(/already this fact/)
  })

  it('finds the table of a dimensional fact; none without members', () => {
    expect(tableOfFact(A, `${P}PropertyPlantAndEquipment`, [...GROSS, ...CLASS('ComputerEquipmentsMember')])).toBe(T)
    expect(tableOfFact(A, `${P}PropertyPlantAndEquipment`, [])).toBeNull()
    expect(() => planTableBlock(A, { ...spec, tableId: 'nope' }, { hasValue: all, columnScope: () => 'CY' })).toThrow(UnknownTableError)
  })
})

describe('C&I: the tangible assets table', () => {
  const A = load('ci')
  const T = '201000:DisclosureOfTangibleAssetsTable'
  const G = 'in-gaap:'
  const GROSS = { axis: `${G}CarryingAmountAccumulatedDepreciationAndGrossCarryingAmountAxis`, member: `${G}GrossCarryingAmountMember` }
  const LAND = { axis: `${G}ClassesOfTangibleAssetsAxis`, member: `${G}LandMember` }
  const BUILDINGS = { axis: `${G}ClassesOfTangibleAssetsAxis`, member: `${G}BuildingsMember` }

  it('plans and files additions per class, CY and PY from the column periods', () => {
    const spec: TableBlockSpec = {
      tableId: T,
      rows: [{ r: 4, concept: `${G}AdditionsOtherThanThroughBusinessCombinationsTangibleAssets`, members: [GROSS] }],
      cols: [{ c: 3, members: [LAND] }, { c: 4, members: [BUILDINGS] }, { c: 6, members: [LAND] }, { c: 7, members: [BUILDINGS] }],
    }
    const plan = planTableBlock(A, spec, { hasValue: all, columnScope: byColumn({ 3: 'CY', 4: 'CY', 6: 'PY', 7: 'PY' }) })
    expect(plan.map((p) => [p.scope, p.problems.length])).toEqual([['CY', 0], ['CY', 0], ['PY', 0], ['PY', 0]])
    const S = new Session(A)
    S.setMeta(META)
    for (const p of plan) S.setTableValue(p.tableId, p.scope!, p.dims, p.concept, '2', {})
    expect((S.getValue(`${G}AdditionsOtherThanThroughBusinessCombinationsTangibleAssets`, 'PY', [GROSS, BUILDINGS]) as { value: string }).value).toBe('200000')
  })
})
