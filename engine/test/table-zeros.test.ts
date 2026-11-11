/**
 * ADR-0013 decision 3: zeros come from the rules, not from Excel. MCA-accepted Dixon reports 1,260 zero table facts;
 * removing them gives 73 ERRORs (ML-13 PPE ×44, ML-6, ML-22 …). The table action fills, in columns that already hold a
 * value, the line items the mandatory-line-items rules require: Dixon without its zeros + the fill → no ERROR from
 * those rules again. Real client data: it stays in this process (docs/12-reference-data.md).
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assembleAuthority, Authority, fillTableMandatoryZeros, importXbrl, Session, tableZeroPlan } from '../src/index'

const KB = (f: string) => new URL(`../../knowledge_base/${f}`, import.meta.url)
const DIXON = new URL('../../data/Instance_Dixon_Global_Private_2025-26_001.xml', import.meta.url)
const json = (u: URL) => JSON.parse(readFileSync(u, 'utf8'))

type Fact = { key: string; concept: string; value: string | null; nil?: boolean; dims: { axis: string }[] }
type Issue = { severity: string; ruleId?: string; code?: string; message: string }
type Rule = { id: string; ast?: { type?: string } }

describe.skipIf(!existsSync(DIXON))('table zeros from the rules (Dixon, Ind AS)', () => {
  const A = new Authority(assembleAuthority(json(KB('ind_as_engine_authority.json')), json(KB('ind_as_engine_rules.json'))))
  const tableRules = new Set((A.rules.rules as Rule[]).filter((r) => r.ast?.type === 'lineItemsMandatory').map((r) => r.id))
  const withoutTableZeros = () => {
    const { filing } = importXbrl(A, readFileSync(DIXON, 'utf8'), { fileName: 'dixon.xml' }) as { filing: { all(): Fact[]; removeFact(k: string): void } }
    const zeros = filing.all().filter((f) => f.dims.length && !f.nil && A.isNumeric(f.concept) && Number(f.value) === 0)
    for (const f of zeros) filing.removeFact(f.key)
    return { session: new Session(A, filing as never), removed: zeros.length, zeroKeys: new Set(zeros.map((f) => f.key)) }
  }
  const errors = (s: Session) => ((s.validate({ today: '2026-11-10' }) as { issues: Issue[] }).issues).filter((i) => i.severity === 'ERROR')
  const summary = (list: Issue[]) => list.map((e) => `${e.ruleId ?? e.code}: ${e.message.slice(0, 220)}`).join('\n')

  it('the full instance needs nothing filled', () => {
    const { filing } = importXbrl(A, readFileSync(DIXON, 'utf8'), { fileName: 'dixon.xml' })
    expect(tableZeroPlan(new Session(A, filing as never))).toEqual([])
  })

  it('without its zero table facts, the fill clears every ERROR (ADR-0013 golden)', () => {
    const { session, removed, zeroKeys } = withoutTableZeros()
    expect(removed).toBe(1260)
    const facts = () => (session as unknown as { filing: { all(): Fact[] } }).filing.all()
    const kept = new Set(facts().map((f) => f.key))
    const before = errors(session).filter((e) => tableRules.has(e.ruleId ?? ''))
    expect(before.length).toBeGreaterThan(50)
    const plan = tableZeroPlan(session)
    const filled = fillTableMandatoryZeros(session)
    expect(filled.slice(0, plan.length)).toEqual(plan) // then the columns its recalculation started (net carrying amounts)
    expect(filled.every((z) => z.dims.length > 0 && ['CY', 'PY'].includes(z.scope))).toBe(true)
    expect(summary(errors(session).filter((e) => tableRules.has(e.ruleId ?? '')))).toBe('')
    expect(tableZeroPlan(session)).toEqual([]) // nothing left to fill
    expect(summary(errors(session))).toBe('') // and the whole filing is back to 0 ERRORs, as filed
    // 2026-11-11: 133 filled + 30 derived = 163 facts, every one a zero Dixon filed; its other 1,097 zeros are optional
    const added = facts().filter((f) => !kept.has(f.key))
    expect(added.length).toBeGreaterThanOrEqual(150)
    expect(added.filter((f) => !zeroKeys.has(f.key)).map((f) => f.key)).toEqual([])
  })

  it('never starts a column that has no value', () => {
    const { session } = withoutTableZeros()
    const s = session as unknown as { filing: { value(q: string, scope: string, dims: unknown[]): unknown; all(): Fact[] } }
    const filledColumns = new Set(s.filing.all().filter((f) => f.dims.length).map((f) => JSON.stringify(f.dims)))
    for (const z of tableZeroPlan(session)) expect(filledColumns.has(JSON.stringify(z.dims))).toBe(true)
  })

  it('one table at a time', () => {
    const { session } = withoutTableZeros()
    const ppe = tableZeroPlan(session, '400600:DisclosureOfPropertyPlantAndEquipmentTable')
    expect(ppe.length).toBeGreaterThan(0)
    expect(new Set(ppe.map((z) => z.tableId))).toEqual(new Set(['400600:DisclosureOfPropertyPlantAndEquipmentTable']))
    expect(new Set(ppe.map((z) => z.ruleId))).toEqual(new Set(['ML-13']))
  })
})
