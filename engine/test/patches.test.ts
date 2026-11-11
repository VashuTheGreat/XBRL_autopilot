/**
 * AI fix patches (ADR-0012): the engine checks every proposed patch before it is shown, applies the fact-level ones
 * through the Session, and dry-runs them on a copy. C&I 2016 authority, synthetic filing (no client data).
 */
import { existsSync, readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { applyFactPatch, Authority, checkPatch, dryRun, nondimAllowed, PatchError, Session, type FactPatch, type FixPatch } from '../src/index'

const AUTH = new URL('../authority/ci-2016.authority.json', import.meta.url)
const ready = existsSync(AUTH)

type Issue = { severity: string; ruleId?: string; factKey?: string; concept?: string }

describe.skipIf(!ready)('AI fix patches on C&I 2016', () => {
  const A = ready ? new Authority(JSON.parse(readFileSync(AUTH, 'utf8'))) : (null as never)
  let S: Session
  const SC = 'in-gaap:ShareCapital'
  const RS = 'in-gaap:ReservesAndSurplus'
  const SF = 'in-gaap:ShareholdersFunds'
  const key = (q: string, scope: 'CY' | 'PY') => (S.getValue(q, scope, []) as { key: string } | null)?.key
  const firstConcept = (pred: (q: string) => boolean) => Object.keys(A.concepts).find(pred)!

  beforeEach(() => {
    S = new Session(A)
    S.setMeta({ name: 'Z Ltd', cin: 'U72200KA2010PTC123456', reportType: 'Standalone', level: 'Lakhs', statementPlaces: 2, displayPlaces: 7,
      periods: { cy: { start: '2025-04-01', end: '2026-03-31' }, py: { start: '2024-04-01', end: '2025-03-31' } } })
    S.setValue(SC, 'PY', '5')
    S.setValue(RS, 'PY', '1.2')
  })

  it('accepts an amount backed by an arithmetic identity and refuses one that is not', () => {
    const patch = (value: string): FactPatch => ({
      op: 'setValue', fact: { concept: SF, scope: 'PY' }, value,
      source: { kind: 'identity', terms: [{ factKey: key(SC, 'PY')!, weight: 1 }, { factKey: key(RS, 'PY')!, weight: 1 }] },
    })
    const ok = checkPatch(S, patch('6.2'))
    expect(ok).toMatchObject({ ok: true, after: '6.2', needsInput: false, needsConfirm: false })
    const bad = checkPatch(S, patch('7'))
    expect(bad.ok).toBe(false)
    expect(bad.problems[0]).toMatch(/identity gives 620000, not 700000/)
    applyFactPatch(S, patch('6.2'))
    expect((S.getValue(SF, 'PY') as { value: string }).value).toBe('620000')
  })

  it('drops patches on unknown, table-only or wrongly typed elements', () => {
    const tableOnly = firstConcept((q) => A.isReportable(q) && A.isNumeric(q) && !nondimAllowed(A as never, q))
    const text = firstConcept((q) => A.isReportable(q) && A.dataType(q) === 'string' && nondimAllowed(A as never, q))
    const user = { kind: 'user' } as const
    expect(checkPatch(S, { op: 'setValue', fact: { concept: 'in-gaap:Nope', scope: 'CY' }, value: '1', source: user }).problems[0]).toMatch(/not a reportable element/)
    expect(checkPatch(S, { op: 'setValue', fact: { concept: tableOnly, scope: 'CY' }, value: '1', source: user }).problems[0]).toMatch(/inside a table/)
    expect(checkPatch(S, { op: 'setValue', fact: { concept: text, scope: 'CY' }, value: '1', source: user }).problems[0]).toMatch(/not an amount/)
    expect(checkPatch(S, { op: 'setText', fact: { concept: SC, scope: 'CY' }, value: 'x', source: user }).problems[0]).toMatch(/is an amount/)
    expect(checkPatch(S, { op: 'setValue', fact: { concept: SC, scope: 'CY' }, value: 'six lakh', source: { kind: 'cell', cell: { workbook: 'w', sheet: 'BS', ref: 'C9' } } }).problems[0]).toMatch(/not a number/)
    expect(checkPatch(S, { op: 'remap', cell: { workbook: 'w', sheet: 'BS', ref: 'D9' }, from: SC, to: text }).problems[0]).toMatch(/different kinds/)
    expect(checkPatch(S, { op: 'remap', cell: { workbook: 'w', sheet: 'BS', ref: 'D9' }, from: SC, to: tableOnly }).ok).toBe(false)
    expect(checkPatch(S, { op: 'remap', cell: { workbook: 'w', sheet: 'BS', ref: 'D9' }, from: SC, to: RS })).toMatchObject({ ok: true, before: 'Share capital', after: 'Reserves and surplus' })
  })

  it('asks the user for an amount that is not in the data, and needs a confirmation for it', () => {
    const p: FactPatch = { op: 'setValue', fact: { concept: SC, scope: 'CY' }, value: null, source: { kind: 'user' } }
    expect(checkPatch(S, p)).toMatchObject({ ok: true, needsInput: true, needsConfirm: true })
    expect(() => applyFactPatch(S, p)).toThrow(PatchError)
    expect(checkPatch(S, p, { input: '6.5' })).toMatchObject({ ok: true, needsInput: false, after: '6.5' })
    applyFactPatch(S, p, { input: '6.5' })
    expect((S.getValue(SC, 'CY') as { value: string }).value).toBe('650000')
  })

  it('removes a fact only with a confirmation, and refuses a stale key', () => {
    const k = key(RS, 'PY')!
    const p: FactPatch = { op: 'removeFact', fact: { key: k, concept: RS, scope: 'PY' } }
    expect(checkPatch(S, p)).toMatchObject({ ok: true, needsConfirm: true, before: '1.2', after: null, factKey: k })
    applyFactPatch(S, p)
    expect(S.getValue(RS, 'PY')).toBeNull()
    expect(() => applyFactPatch(S, p)).toThrow(/no longer in the filing/)
    expect(checkPatch(S, { op: 'removeFact', fact: { key: key(SC, 'PY')!, concept: RS, scope: 'PY' } }).problems[0]).toMatch(/do not match/)
    expect(checkPatch(S, { op: 'removeFact', fact: { key: key(SC, 'PY')!, concept: SC, scope: 'CY' } }).problems[0]).toMatch(/not a current-year value/)
  })

  it('a set op whose key does not fit its element and year targets the element and year', () => {
    const c = checkPatch(S, { op: 'setValue', fact: { key: key(SC, 'PY')!, concept: SC, scope: 'CY' }, value: '6.5', source: { kind: 'user' } }, { input: '6.5' })
    expect(c).toMatchObject({ ok: true, before: null, factKey: null })
    expect(checkPatch(S, { op: 'setNil', fact: { key: 'gone', concept: RS, scope: 'PY' } })).toMatchObject({ ok: true, before: '1.2', factKey: key(RS, 'PY') })
  })

  it('reports nil and text values through the session', () => {
    applyFactPatch(S, { op: 'setNil', fact: { concept: RS, scope: 'PY' } })
    expect(S.getValue(RS, 'PY')).toMatchObject({ nil: true, origin: 'ai' })
    const flag = firstConcept((q) => A.isReportable(q) && A.dataType(q) === 'boolean' && nondimAllowed(A as never, q) && S.conceptStatus(q, 'CY').applicable)
    const p: FactPatch = { op: 'setText', fact: { concept: flag, scope: 'CY' }, value: 'No', source: { kind: 'user' } }
    expect(checkPatch(S, p)).toMatchObject({ ok: true, after: 'false', needsConfirm: true })
    applyFactPatch(S, p)
    expect((S.getValue(flag, 'CY') as { value: string }).value).toBe('false')
    expect(checkPatch(S, { ...p, value: 'maybe' } as FixPatch).problems[0]).toMatch(/true\/false/)
  })

  it('refuses the previous year in a first financial year', () => {
    S.setMeta({ firstFinancialYear: true, periods: { cy: { start: '2025-04-01', end: '2026-03-31' }, py: null } })
    expect(checkPatch(S, { op: 'setNil', fact: { concept: SC, scope: 'PY' } }).problems[0]).toMatch(/first financial year/)
    expect(checkPatch(S, { op: 'setScope', cell: { workbook: 'w', sheet: 'BS', ref: 'C9' }, to: 'PY' }).ok).toBe(false)
  })

  it('dry-runs patches on a copy: the CY/PY pairing problem clears, the filing stays as it was', () => {
    const rule = (A.rules.rules as { id: string; ast?: { handler?: string } }[]).find((r) => r.ast?.handler === 'cy-py-pairing')!.id
    const pairing = (issues: Issue[]) => issues.filter((i) => i.severity === 'ERROR' && i.ruleId === rule && i.factKey === key(SC, 'PY'))
    expect(pairing(S.validate({ today: '2026-11-11' }).issues as Issue[]).length).toBe(1)
    const run = dryRun(S, [{ patch: { op: 'setValue', fact: { concept: SC, scope: 'CY' }, value: '6.5', source: { kind: 'cell', cell: { workbook: 'w', sheet: 'BS', ref: 'C9' } } } }], { today: '2026-11-11' })
    expect(run.failed).toEqual([])
    expect(pairing(run.issues as Issue[])).toEqual([])
    expect(S.getValue(SC, 'CY')).toBeNull()
    const bad = dryRun(S, [{ patch: { op: 'setValue', fact: { concept: 'in-gaap:Nope', scope: 'CY' }, value: '1', source: { kind: 'user' } } }])
    expect(bad.failed[0]!.problems[0]).toMatch(/not a reportable/)
  })
})
