/**
 * Statement ↔ note matching (docs/14 Step 1): noteTies / statementDifference.
 * - Synthetic filings on the C&I knowledge-base authority: note-empty → ok → mismatch, nil balances, closed years,
 *   the statement's own calculation differences.
 * - Golden: MCA-accepted Dixon (Ind AS, DGPL's filed instance): every line its notes supply ties, both statements add
 *   up; breaking one note value shows the mismatch. Real client data stays in this process (docs/12).
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assembleAuthority, Authority, importXbrl, noteTies, Session, statementDifference, type NoteTie } from '../src/index'
import { calculationNetworks } from '../src/core/calculation.js'

const KB = (f: string) => new URL(`../../knowledge_base/${f}`, import.meta.url)
const DIXON = new URL('../../data/Instance_Dixon_Global_Private_2025-26_001.xml', import.meta.url)
const json = (u: URL) => JSON.parse(readFileSync(u, 'utf8'))
const load = (kb: string) => new Authority(assembleAuthority(json(KB(`${kb}_engine_authority.json`)), json(KB(`${kb}_engine_rules.json`))))

type Elr = { uri: string; code: string; group: string; title?: string }
type Fact = { key: string; concept: string; value: string; dims: unknown[]; period: unknown }
const META = {
  name: 'Z Pvt Ltd', cin: 'U72200KA2010PTC123456', reportType: 'Standalone', level: 'Actual', statementPlaces: 2, displayPlaces: 2,
  periods: { cy: { start: '2025-04-01', end: '2026-03-31' }, py: { start: '2024-04-01', end: '2025-03-31' } },
}
const elrOf = (A: Authority, code: string) => (A.elrs as Elr[]).find((e) => e.code === code)!.uri
const tieOf = (ties: NoteTie[], local: string) => ties.find((t) => t.concept.endsWith(`:${local}`))!

describe('note ties on a synthetic C&I filing', () => {
  const A = load('ci')
  const BS = elrOf(A, '100100')
  const Q = (local: string) => `in-gaap:${local}`
  const session = (meta: Partial<typeof META> & { firstFinancialYear?: boolean } = {}) => {
    const S = new Session(A)
    S.setMeta({ ...META, ...meta })
    return S
  }
  // a part of Other current liabilities in its note's calculation network (read from the taxonomy, not hard-coded)
  const NOTE = (A.elr(tieOf(noteTies(session(), BS), 'OtherCurrentLiabilities').target.elrUri) as Elr).code.slice(0, 6)
  const part = (calculationNetworks(A) as { elr: string; parent: string; children: { to: string }[] }[]).find(
    (n) => n.parent === Q('OtherCurrentLiabilities') && (A.json.roles[n.elr] as { code: string }).code.startsWith(NOTE),
  )!.children[0]!.to

  it('lists only the lines of a main statement that a note supplies, with their target', () => {
    const ties = noteTies(session(), BS)
    expect(ties.length).toBeGreaterThan(10)
    expect(tieOf(ties, 'ShareCapital')).toMatchObject({ kind: 'sum', target: { tableId: expect.any(String), concept: Q('ShareCapital') } })
    expect(tieOf(ties, 'OtherCurrentLiabilities')).toMatchObject({ kind: 'row', target: { concept: Q('OtherCurrentLiabilities') } })
    expect(tieOf(ties, 'Inventories')).toMatchObject({ kind: 'column', target: { tableId: expect.any(String) } })
    // a note is not a statement: nothing to tie there
    expect(noteTies(session(), ties[0]!.target.elrUri)).toEqual([])
  })

  it('note-empty → ok → mismatch as the note is filled and then broken; amounts are decimal strings', () => {
    const S = session()
    S.setValue(Q('OtherCurrentLiabilities'), 'CY', '1000.50')
    expect(tieOf(noteTies(S, BS), 'OtherCurrentLiabilities').cy).toEqual({ statement: '1000.5', note: null, difference: null, status: 'note-empty' })
    S.setValue(part, 'CY', '1000.50', { recalc: true })
    expect(tieOf(noteTies(S, BS), 'OtherCurrentLiabilities').cy).toEqual({ statement: '1000.5', note: '1000.5', difference: '0', status: 'ok' })
    S.setValue(part, 'CY', '600.25') // the note changed without recalculating the total
    expect(tieOf(noteTies(S, BS), 'OtherCurrentLiabilities').cy).toEqual({ statement: '1000.5', note: '600.25', difference: '400.25', status: 'mismatch' })
  })

  it('a nil balance needs no note; an empty line has nothing to compare; a first year has no PY', () => {
    const S = session({ firstFinancialYear: true })
    S.setValue(Q('OtherCurrentLiabilities'), 'CY', '0')
    const ties = noteTies(S, BS)
    expect(tieOf(ties, 'OtherCurrentLiabilities').cy).toEqual({ statement: '0', note: null, difference: null, status: 'ok' })
    expect(tieOf(ties, 'OtherLongTermLiabilities').cy.status).toBe('no-statement')
    expect(ties.every((t) => t.py.status === 'no-statement')).toBe(true)
    expect(statementDifference(S, BS).py).toBeNull()
  })

  it('statementDifference: the statement’s own totals that do not add up, per year, generic (no fixed formula)', () => {
    const S = session()
    expect(statementDifference(S, BS)).toEqual({ cy: { difference: '0', issues: [] }, py: { difference: '0', issues: [] } })
    S.setValue(Q('ShareCapital'), 'CY', '500')
    S.setValue(Q('ReservesAndSurplus'), 'CY', '100')
    S.setValue(Q('ShareholdersFunds'), 'CY', '700') // typed: 100 more than its parts
    const d = statementDifference(S, BS)
    expect(d.cy!.issues).toEqual([expect.objectContaining({ parent: Q('ShareholdersFunds'), reported: '700', computed: '600', difference: '100' })])
    expect(d.cy!.difference).toBe('100')
    expect(d.py).toEqual({ difference: '0', issues: [] })
  })
})

describe.skipIf(!existsSync(DIXON))('note ties on Dixon (Ind AS, MCA-accepted)', () => {
  const A = load('ind_as')
  const open = () => new Session(A, importXbrl(A, readFileSync(DIXON, 'utf8'), { fileName: 'dixon.xml' }).filing as never)
  const statements = (A.elrs as Elr[]).filter((e) => e.group === 'Statements')
  const BS = elrOf(A, '110000')

  it('every line its notes supply ties, and every statement adds up (difference 0)', () => {
    const S = open()
    const bad: string[] = []
    let ok = 0
    for (const e of statements) {
      for (const t of noteTies(S, e.uri)) {
        for (const [y, p] of [['CY', t.cy], ['PY', t.py]] as const) {
          if (p.status === 'ok') ok++
          else if (p.status !== 'no-statement') bad.push(`${e.code} ${t.concept} ${y}: ${p.status} ${p.statement} vs ${p.note}`)
        }
      }
      const d = statementDifference(S, e.uri)
      for (const p of [d.cy, d.py]) if (p) expect(p).toEqual({ difference: '0', issues: [] })
    }
    expect(bad.join('\n')).toBe('')
    expect(ok).toBeGreaterThanOrEqual(55) // 2026-11-14: 55 ties ok (35 balance sheet, 16 P&L, 4 changes in equity)
    const ties = noteTies(S, BS)
    expect(tieOf(ties, 'TradeReceivablesCurrent').cy).toEqual({ statement: '67230000', note: '67230000', difference: '0', status: 'ok' })
    expect(tieOf(ties, 'CashAndCashEquivalents').py).toMatchObject({ statement: '32655000', status: 'ok' })
  })

  it('a broken note value shows the mismatch and its difference', () => {
    const S = open()
    const filing = (S as unknown as { filing: { factsOf(q: string): Fact[]; setFact(f: Record<string, unknown>): void; scopeOf(p: unknown): string } }).filing
    // the current loans to related parties (the rule's first-level member), changed in the filing itself (as an import would carry it)
    type D = { axis: string; member?: string }
    const f = filing.factsOf('ind-as:Loans').find((x) => (x.dims as D[]).some((d) => d.member === 'ind-as:LoansToRelatedPartiesMember') && filing.scopeOf(x.period) === 'CY' && Number(x.value) > 0)!
    filing.setFact({ ...f, value: String(Number(f.value) - 1000) })
    expect(tieOf(noteTies(S, BS), 'LoansCurrent').cy).toMatchObject({ statement: '102000000', note: '101999000', difference: '1000', status: 'mismatch' })
  })
})
