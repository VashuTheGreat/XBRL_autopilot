/**
 * Statement tree marks (docs/14 Step 2): textBlockMark (E / L), elrTableOf (T), mandatoryGap (red mandatory lines).
 * - Synthetic: the C&I knowledge-base authority; markers read from taxonomy data, mandatory lines from the MCA rules.
 * - Golden: MCA-accepted Dixon (Ind AS, DGPL's filed instance) leaves no mandatory statement line empty.
 *   Real client data stays in this process (docs/12).
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assembleAuthority, Authority, buildElrView, elrTableOf, importXbrl, mandatoryCell, mandatoryGap, Session, textBlockMark } from '../src/index'

const KB = (f: string) => new URL(`../../knowledge_base/${f}`, import.meta.url)
const DIXON = new URL('../../data/Instance_Dixon_Global_Private_2025-26_001.xml', import.meta.url)
const json = (u: URL) => JSON.parse(readFileSync(u, 'utf8'))
const load = (kb: string) => new Authority(assembleAuthority(json(KB(`${kb}_engine_authority.json`)), json(KB(`${kb}_engine_rules.json`))))

type Elr = { uri: string; code: string; group: string }
type Row = { kind: string; concept?: string; dataType?: string }
const META = {
  name: 'Z Pvt Ltd', cin: 'U72200KA2010PTC123456', reportType: 'Standalone', level: 'Actual', statementPlaces: 2, displayPlaces: 2,
  periods: { cy: { start: '2025-04-01', end: '2026-03-31' }, py: { start: '2024-04-01', end: '2025-03-31' } },
}
const elrOf = (A: Authority, code: string) => (A.elrs as Elr[]).find((e) => e.code === code)!.uri
const items = (A: Authority, uri: string) => (buildElrView(A, uri).rows as Row[]).filter((r) => r.kind === 'item').map((r) => r.concept!)
/** the empty mandatory lines of an ELR, per year */
const gaps = (S: Session, A: Authority, uri: string) =>
  items(A, uri).flatMap((q) => (['CY', 'PY'] as const).filter((y) => mandatoryGap(S, q, y, uri)).map((y) => `${q} ${y}`))

describe('form marks on the C&I taxonomy', () => {
  const A = load('ci')
  const BS = elrOf(A, '100100')
  const Q = (local: string) => `in-gaap:${local}`
  const session = (meta: Record<string, unknown> = {}) => {
    const S = new Session(A)
    S.setMeta({ ...META, ...meta })
    return S
  }

  it('E for a text block shown in one ELR, L for one shown in several (with the other codes), nothing for amounts', () => {
    const textBlocks = (A.elrs as Elr[]).flatMap((e) => items(A, e.uri).filter((q) => A.dataType(q) === 'textBlock').map((q) => ({ q, uri: e.uri })))
    expect(textBlocks.length).toBeGreaterThan(100)
    const marks = textBlocks.map(({ q, uri }) => ({ q, uri, m: textBlockMark(A, q, uri)! }))
    // the marker follows the presentation links, never a name or a code
    for (const { q, uri, m } of marks) expect(m.marker).toBe((A.conceptElrs(q) as string[]).some((u) => u !== uri) ? 'L' : 'E')
    const linked = marks.find((x) => x.m.marker === 'L')!
    expect(linked.m.linkedElrs).toEqual((A.conceptElrs(linked.q) as string[]).filter((u) => u !== linked.uri).map((u) => (A.elr(u) as Elr).code))
    expect(marks.some((x) => x.m.marker === 'E' && x.m.linkedElrs.length === 0)).toBe(true)
    expect(textBlockMark(A, Q('ShareCapital'), BS)).toBeNull()
  })

  it('T: the dimensional table of the ELR for its hypercube node; none for another node', () => {
    const t = (A.tables as { id: string; hypercube: string; presentationElr: string; axes: unknown[] }[]).find((x) => x.axes.length && x.presentationElr)!
    const id = elrTableOf(A, t.presentationElr, t.hypercube)
    expect(id).not.toBeNull()
    expect((A.table(id!) as { hypercube: string }).hypercube).toBe(t.hypercube)
    expect(elrTableOf(A, t.presentationElr, Q('ShareCapital'))).toBeNull()
  })

  it('an empty line the MCA rules require is a gap per year, with the rule; a value (0 too) clears it', () => {
    const S = session()
    const gap = mandatoryGap(S, Q('LongTermBorrowings'), 'CY', BS)
    // the same rules mandatoryCell reports (no mandatory logic of its own)
    expect(gap).toEqual({ rules: (mandatoryCell(S, Q('LongTermBorrowings'), 'CY') as { rules: string[] }).rules, conditional: false })
    expect(gap!.rules.length).toBeGreaterThan(0)
    expect(mandatoryGap(S, Q('LongTermBorrowings'), 'PY', BS)).not.toBeNull()
    S.setValue(Q('LongTermBorrowings'), 'CY', '0')
    expect(mandatoryGap(S, Q('LongTermBorrowings'), 'CY', BS)).toBeNull()
    expect(mandatoryGap(S, Q('LongTermBorrowings'), 'PY', BS)).not.toBeNull()
    // a line no rule requires is never a gap
    expect(mandatoryGap(S, Q('ShareholdersFunds'), 'CY', BS)).toBeNull()
  })

  it('a first financial year has no PY gaps', () => {
    const S = session({ firstFinancialYear: true })
    expect(mandatoryGap(S, Q('LongTermBorrowings'), 'CY', BS)).not.toBeNull()
    expect(gaps(S, A, BS).filter((g) => g.endsWith(' PY'))).toEqual([])
  })
})

describe.skipIf(!existsSync(DIXON))('form marks on Dixon (Ind AS, MCA-accepted)', () => {
  const A = load('ind_as')
  const statements = (A.elrs as Elr[]).filter((e) => e.group === 'Statements')

  it('the filed statements leave no mandatory line empty; an empty filing shows them', () => {
    const S = new Session(A, importXbrl(A, readFileSync(DIXON, 'utf8'), { fileName: 'dixon.xml' }).filing as never)
    const BS = elrOf(A, '110000')
    expect(statements.flatMap((e) => gaps(S, A, e.uri).map((g) => `${e.code} ${g}`))).toEqual([])
    const empty = new Session(A)
    empty.setMeta(META)
    expect(gaps(empty, A, BS).length).toBeGreaterThan(0)
  })
})
