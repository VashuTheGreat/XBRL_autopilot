/**
 * Mandatory non-numeric items, required tables and key answers (docs/14 Step 5).
 * - Synthetic C&I and Ind AS filings on the knowledge-base authorities: the list is non-numeric, per year, cleared by
 *   a value; the two conditional pairs (CSR applicable → CSR items; auditor's report qualified → the remarks) as the
 *   compiled rules decide them in each taxonomy; the curated key answers.
 * - Golden: MCA-accepted Dixon (Ind AS, DGPL's filed instance) leaves nothing mandatory empty and answers every key
 *   question. Real client data stays in this process (docs/12).
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyFactPatch, assembleAuthority, Authority, importXbrl, keyAnswers, mandatoryInputs, requiredTables, Session } from '../src/index'

const KB = (f: string) => new URL(`../../knowledge_base/${f}`, import.meta.url)
const DIXON = new URL('../../data/Instance_Dixon_Global_Private_2025-26_001.xml', import.meta.url)
const json = (u: URL) => JSON.parse(readFileSync(u, 'utf8'))
const load = (kb: string) => new Authority(assembleAuthority(json(KB(`${kb}_engine_authority.json`)), json(KB(`${kb}_engine_rules.json`))))
const META = {
  name: 'Z Pvt Ltd', cin: 'U72200KA2010PTC123456', reportType: 'Standalone', level: 'Actual', statementPlaces: 2, displayPlaces: 2,
  periods: { cy: { start: '2025-04-01', end: '2026-03-31' }, py: { start: '2024-04-01', end: '2025-03-31' } },
}
const TODAY = '2026-11-14'
const QUAL = 'in-ca:WhetherAuditorsReportHasBeenQualifiedOrHasAnyReservationsOrContainsAdverseRemarks'
const REMARKS = 'in-ca:AuditorsQualificationsReservationsOrAdverseRemarksInAuditorsReport'
const SUBSIDIARY = 'in-ca:WhetherCompanyIsSubsidiaryCompany'
const HAS_SUBSIDIARIES = 'in-ca:WhetherCompanyHasSubsidiaryCompanies'

const session = (A: Authority) => {
  const S = new Session(A)
  S.setMeta(META)
  return S
}
const answer = (S: Session, concept: string, value: string) => applyFactPatch(S, { op: 'setText', fact: { concept, scope: 'CY' }, value, source: { kind: 'user' } })
const listed = (S: Session, concept: string) => mandatoryInputs(S).filter((i) => i.concept === concept)

describe.each([
  ['ci', 'in-gaap'],
  ['ind_as', 'ind-as'],
])('mandatory inputs on %s', (kb, ns) => {
  const A = load(kb)
  const CSR = `${ns}:WhetherProvisionsOfCorporateSocialResponsibilityAreApplicableOnCompany`
  const POLICY = `${ns}:WhetherCompanyHasWrittenCSRPolicy`

  it('lists only empty non-numeric items the rules require, per year; a value clears that year', () => {
    const S = session(A)
    const items = mandatoryInputs(S)
    expect(items.length).toBeGreaterThan(10)
    expect(items.every((i) => !A.isNumeric(i.concept))).toBe(true)
    expect(new Set(items.map((i) => i.dataType)).has('boolean')).toBe(true)
    expect(items.every((i) => i.rules.length > 0 && i.reasons.length === i.rules.length)).toBe(true)
    expect(listed(S, CSR).map((i) => i.scope)).toContain('CY')
    answer(S, CSR, 'true')
    expect(listed(S, CSR).map((i) => i.scope)).not.toContain('CY')
  })

  it('CSR applicable: Yes requires the CSR policy answer, No does not', () => {
    const S = session(A)
    answer(S, CSR, 'true')
    expect(listed(S, POLICY)).toEqual([expect.objectContaining({ scope: 'CY', conditional: true })])
    answer(S, CSR, 'false')
    expect(listed(S, POLICY)).toEqual([])
    // C&I's dependency closes the CSR items under No; Ind AS's keeps them open (MCA accepted filings report them)
    expect(S.conceptStatus(POLICY, 'CY').applicable).toBe(kb !== 'ci')
  })

  it('auditor’s report qualified: Yes requires the remarks (a field in Ind AS, a table in C&I), No does not', () => {
    const S = session(A)
    answer(S, QUAL, 'false')
    expect(listed(S, REMARKS)).toEqual([])
    expect(requiredTables(S, TODAY).filter((t) => t.reason.includes(QUAL.split(':')[1]!))).toEqual([])
    answer(S, QUAL, 'true')
    if (kb === 'ind_as') {
      expect(listed(S, REMARKS)).toEqual([expect.objectContaining({ scope: 'CY', conditional: true, dataType: 'string' })])
    } else {
      expect(listed(S, REMARKS)).toEqual([])
      const tables = requiredTables(S, TODAY).filter((t) => t.reason.includes(QUAL.split(':')[1]!))
      expect(tables).toEqual([expect.objectContaining({ scope: 'CY', ruleId: 'SR-L3893-1', tableId: expect.any(String), elrUri: expect.any(String) })])
    }
  })

  it('key answers: the curated four, with the current answer and what each decides', () => {
    const S = session(A)
    const keys = keyAnswers(S)
    expect(keys.map((k) => k.concept)).toEqual([SUBSIDIARY, HAS_SUBSIDIARIES, CSR, QUAL])
    expect(keys.every((k) => k.value === null && k.elrUri && k.rules.length > 0)).toBe(true)
    expect(keys.find((k) => k.concept === CSR)!.decides.map((d) => d.concept)).toContain(POLICY)
    answer(S, CSR, 'false')
    expect(keyAnswers(S).find((k) => k.concept === CSR)).toMatchObject({ value: false, requiredWhen: true })
  })
})

describe.skipIf(!existsSync(DIXON))('mandatory inputs on Dixon (Ind AS, MCA-accepted)', () => {
  const A = load('ind_as')
  it('nothing mandatory is left empty, no required table is missing, every key question is answered', () => {
    const S = new Session(A, importXbrl(A, readFileSync(DIXON, 'utf8'), { fileName: 'dixon.xml' }).filing as never)
    expect(mandatoryInputs(S).map((i) => `${i.concept} ${i.scope}`)).toEqual([])
    expect(requiredTables(S, TODAY)).toEqual([])
    expect(keyAnswers(S).map((k) => k.value)).toEqual([true, false, false, false]) // a subsidiary, no subsidiaries, CSR not applicable, unqualified report
  })
})
