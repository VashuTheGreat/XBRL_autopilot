/**
 * Parent-member roll-ups (ADR-0013, Phase 11 step 3b): a table value under a child member derives its parent members
 * by summing the children (member-rollup.js, Session.deriveFrom). Golden: MCA-accepted Dixon (Ind AS) without its
 * parent-member facts, re-derived from the children → the same values and 0 ERRORs. Plus the derivation's manners on a
 * synthetic filing (Ind AS changes in equity) and on C&I. Real client data stays in this process (docs/12).
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assembleAuthority, Authority, importXbrl, Session } from '../src/index'
import { memberTrees, rollupAxesOf, rollupChildrenOf } from '../src/core/member-rollup.js'

const KB = (f: string) => new URL(`../../knowledge_base/${f}`, import.meta.url)
const DIXON = new URL('../../data/Instance_Dixon_Global_Private_2025-26_001.xml', import.meta.url)
const json = (u: URL) => JSON.parse(readFileSync(u, 'utf8'))
const load = (kb: string) => new Authority(assembleAuthority(json(KB(`${kb}_engine_authority.json`)), json(KB(`${kb}_engine_rules.json`))))

type Dim = { axis: string; member?: string; typed?: string }
type Fact = { key: string; concept: string; value: string | null; nil?: boolean; dims: Dim[]; period: unknown; origin?: string; decimals?: string }
type Filing = { all(): Fact[]; removeFact(k: string): void; get(q: string, p: unknown, d: Dim[]): Fact | null }
type Issue = { severity: string; ruleId?: string; code?: string; message: string }
const META = {
  name: 'Z Pvt Ltd', cin: 'U72200KA2010PTC123456', reportType: 'Standalone', level: 'Lakhs', statementPlaces: 2, displayPlaces: 7,
  periods: { cy: { start: '2025-04-01', end: '2026-03-31' }, py: { start: '2024-04-01', end: '2025-03-31' } },
}

describe('Ind AS: changes in equity roll up Other retained earning → Retained earnings → Reserves → Equity attributable', () => {
  const A = load('ind_as')
  const P = 'ind-as:'
  const T = '400200:StatementOfChangesInEquityTable'
  const AX = `${P}ComponentsOfEquityAxis`
  const at = (m: string) => [{ axis: AX, member: `${P}${m}` }]
  const value = (S: Session, m: string) => (S.getValue(`${P}ProfitLossForPeriod`, 'CY', at(m)) as Fact | null)?.value ?? null
  const session = () => {
    const S = new Session(A)
    S.setMeta(META)
    S.setValue(`${P}OtherEquity`, 'CY', '100', { recalc: true }) // opens the table (SR-L694-1)
    return S
  }
  const put = (S: Session, m: string, v: string) => S.setTableValue(T, 'CY', at(m), `${P}ProfitLossForPeriod`, v, { recalc: true })

  it('reads the member trees from the authority: the axis default is never a parent', () => {
    const tree = memberTrees(A).get(AX)!
    expect(tree.parentOf.get(`${P}OtherRetainedEarningMember`)).toBe(`${P}RetainedEarningsMember`)
    expect(tree.parentOf.get(`${P}RetainedEarningsMember`)).toBe(`${P}ReservesMember`)
    expect(tree.parentOf.get(`${P}ReservesMember`)).toBe(`${P}EquityAttributableToTheEquityHoldersOfTheParentMember`)
    expect(tree.parentOf.has(`${P}EquityAttributableToTheEquityHoldersOfTheParentMember`)).toBe(false) // its parent is the default (Equity)
  })

  it('a leaf value files every parent member up the tree; siblings add up; removing it removes them', () => {
    const S = session()
    put(S, 'OtherRetainedEarningMember', '2.5')
    for (const m of ['RetainedEarningsMember', 'ReservesMember', 'EquityAttributableToTheEquityHoldersOfTheParentMember']) expect(value(S, m)).toBe('250000')
    expect(value(S, 'EquityMember')).toBeNull() // the default (total) is not a roll-up
    put(S, 'GeneralReserveMember', '1')
    expect(value(S, 'RetainedEarningsMember')).toBe('250000')
    expect(value(S, 'ReservesMember')).toBe('350000')
    expect(value(S, 'EquityAttributableToTheEquityHoldersOfTheParentMember')).toBe('350000')
    put(S, 'OtherRetainedEarningMember', '')
    expect(value(S, 'RetainedEarningsMember')).toBeNull()
    expect(value(S, 'ReservesMember')).toBe('100000')
  })

  it('an entered parent that differs is the filer’s figure and is kept; one that agreed follows its children', () => {
    const S = session()
    put(S, 'OtherRetainedEarningMember', '2')
    put(S, 'ReservesMember', '9') // typed: differs from its children
    put(S, 'OtherRetainedEarningMember', '3')
    expect(value(S, 'RetainedEarningsMember')).toBe('300000')
    expect(value(S, 'ReservesMember')).toBe('900000')
    const T2 = session()
    put(T2, 'OtherRetainedEarningMember', '2')
    put(T2, 'ReservesMember', '2') // typed, but equal to its children: it follows them
    put(T2, 'OtherRetainedEarningMember', '3')
    expect(value(T2, 'ReservesMember')).toBe('300000')
  })

  it('percentages and per-share figures never roll up', () => {
    const pct = A.concepts && Object.keys((A as unknown as { json: { concepts: Record<string, { type?: string }> } }).json.concepts).find((q) => /percentItemType/.test((A as unknown as { json: { concepts: Record<string, { type?: string }> } }).json.concepts[q]!.type ?? ''))
    expect(pct).toBeTruthy()
    expect(rollupAxesOf(A, pct!, at('ReservesMember'))).toEqual([])
    expect(rollupChildrenOf(A, pct!, AX, at('ReservesMember'))).toEqual([])
  })
})

describe.skipIf(!existsSync(DIXON))('golden: Dixon without its parent-member facts, re-derived (Ind AS)', () => {
  const A = load('ind_as')
  const errors = (s: Session) => ((s.validate({ today: '2026-11-11' }) as { issues: Issue[] }).issues).filter((i) => i.severity === 'ERROR')
  const summary = (list: Issue[]) => list.map((e) => `${e.ruleId ?? e.code}: ${e.message.slice(0, 200)}`).join('\n')
  const numeric = (f: Fact) => !f.nil && f.value !== null && A.isNumeric(f.concept)
  /** a filed parent-member value whose children are filed too: what the roll-up derives */
  const isRollup = (filing: Filing, f: Fact) =>
    numeric(f) && rollupAxesOf(A, f.concept, f.dims).some((ax) => rollupChildrenOf(A, f.concept, ax, f.dims).some((k) => !!filing.get(f.concept, f.period, k.dims)))

  it('every filed parent-member value equals the sum of its filed children', () => {
    const { filing } = importXbrl(A, readFileSync(DIXON, 'utf8'), { fileName: 'dixon.xml' }) as { filing: Filing }
    const S = new Session(A, filing as never) as unknown as { memberRollupValue(q: string, p: unknown, d: Dim[], ax: string): { value: string } | null }
    const parents = filing.all().filter((f) => isRollup(filing, f))
    expect(parents.length).toBeGreaterThanOrEqual(30)
    const off = parents.flatMap((f) =>
      rollupAxesOf(A, f.concept, f.dims)
        .map((ax) => ({ ax, v: S.memberRollupValue(f.concept, f.period, f.dims, ax) }))
        .filter(({ v }) => v && Number(v.value) !== Number(f.value))
        .map(({ ax, v }) => `${f.concept} ${JSON.stringify(f.dims)} on ${ax}: filed ${f.value}, children ${v!.value}`),
    )
    expect(off).toEqual([])
  })

  it('removing them and re-deriving from the children gives the same values and 0 ERRORs', () => {
    const { filing } = importXbrl(A, readFileSync(DIXON, 'utf8'), { fileName: 'dixon.xml' }) as { filing: Filing }
    const removed = filing.all().filter((f) => isRollup(filing, f))
    for (const f of removed) filing.removeFact(f.key)
    const S = new Session(A, filing as never)
    const s = S as unknown as { recalcFrom(q: string, p: unknown, d: Dim[], depth: number, change: unknown): void }
    for (const f of filing.all()) if (numeric(f) && f.dims.length) s.recalcFrom(f.concept, f.period, f.dims, 0, null)
    const back = removed.map((f) => ({ f, now: filing.get(f.concept, f.period, f.dims) }))
    const missing = back.filter((x) => !x.now || Number(x.now.value) !== Number(x.f.value)).map((x) => `${x.f.concept} ${JSON.stringify(x.f.dims)}: filed ${x.f.value}, now ${x.now?.value ?? '—'}`)
    expect(missing).toEqual([])
    expect(back.every((x) => x.now!.origin === 'calculated')).toBe(true)
    expect(summary(errors(S))).toBe('')
    expect(removed.length).toBeGreaterThanOrEqual(30)
  })
})

describe('C&I: the same derivation from the C&I member trees (share capital classes, GR-3 parent members)', () => {
  const A = load('ci')
  const G = 'in-gaap:'
  const T = '200100:DisclosureOfClassesOfShareCapitalTable'
  const AX = `${G}ClassesOfShareCapitalAxis`
  it('Equity shares 1 rolls up to Equity shares', () => {
    expect(memberTrees(A).get(AX)!.parentOf.get(`${G}EquityShares1Member`)).toBe(`${G}EquitySharesMember`)
    const S = new Session(A)
    S.setMeta(META)
    S.setTableValue(T, 'CY', [{ axis: AX, member: `${G}EquityShares1Member` }], `${G}ValueOfSharesAuthorised`, '1.5', { recalc: true })
    const parent = S.getValue(`${G}ValueOfSharesAuthorised`, 'CY', [{ axis: AX, member: `${G}EquitySharesMember` }]) as Fact | null
    expect(parent).toMatchObject({ value: '150000', origin: 'calculated' })
  })
})
