/**
 * Masters (docs/14 Step 9).
 * - Synthetic C&I and Ind AS filings on the knowledge-base authorities: the sections the curation names, their fields
 *   (enumerations, the designation vocabulary, formats from type patterns / rule formats / curation), writing card
 *   items and grid rows through the Session, fill targets by shared elements, filling without duplicates.
 * - Golden: MCA-accepted Dixon (Ind AS, DGPL's filed instance) reads back its auditor and directors, and its auditor's
 *   PAN agrees with the firm's name. Real client data stays in this process (docs/12).
 * - The pure format and PAN checks (basics).
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { formatProblem, panNameProblems } from '../src/basics'
import { FORMATS } from '../src/core/expr.js'
import {
  assembleAuthority,
  Authority,
  fillTableFromRecords,
  fillTargets,
  importXbrl,
  masterItemValues,
  masterSections,
  masterTableRows,
  nextMasterMember,
  panPairs,
  removeMasterRow,
  Session,
  setMasterCell,
  setMasterItem,
  type MasterSection,
} from '../src/index'

const KB = (f: string) => new URL(`../../knowledge_base/${f}`, import.meta.url)
const DIXON = new URL('../../data/Instance_Dixon_Global_Private_2025-26_001.xml', import.meta.url)
const json = (u: URL) => JSON.parse(readFileSync(u, 'utf8'))
const load = (kb: string) => new Authority(assembleAuthority(json(KB(`${kb}_engine_authority.json`)), json(KB(`${kb}_engine_rules.json`))))
const META = {
  name: 'Z Pvt Ltd', cin: 'U72200KA2010PTC123456', reportType: 'Standalone', level: 'Actual', statementPlaces: 2, displayPlaces: 2,
  periods: { cy: { start: '2025-04-01', end: '2026-03-31' }, py: { start: '2024-04-01', end: '2025-03-31' } },
}
const DESIGNATION = 'in-ca:DesignationOfDirector'
const FIRST_NAME = 'in-ca:FirstNameOfDirector'
const DIN = 'in-ca:DirectorIdentificationNumberOfDirector'
const AUDITOR_PAN = 'in-ca:PermanentAccountNumberOfAuditorOrAuditorsFirm'

const session = (A: Authority) => {
  const S = new Session(A)
  S.setMeta(META)
  return S
}
const section = (s: MasterSection[], id: string) => s.find((x) => x.id === id)!
const tableWith = (sec: MasterSection, q: string) => sec.tables.find((t) => t.columns.some((c) => c.concept === q))!
const A_ = (A: Authority) => A as never

describe.each(['ci', 'ind_as'])('masters on %s', (kb) => {
  const A = load(kb)
  const sections = masterSections(A_(A))
  const directors = tableWith(section(sections, 'signatories'), DIN)
  const auditors = section(sections, 'auditor').tables[0]!

  it('finds the three sections by title, with the company card, the auditor grid and the signatory grids', () => {
    expect(sections.map((s) => s.id)).toEqual(['company', 'auditor', 'signatories'])
    const company = section(sections, 'company')
    expect(company.tables).toEqual([])
    expect(company.items.map((f) => f.concept)).toEqual(expect.arrayContaining(['in-ca:NameOfCompany', 'in-ca:CorporateIdentityNumber']))
    expect(company.items.find((f) => f.concept === 'in-ca:NameOfCompany')!.heading).toMatch(/company information/i)
    expect(company.items.some((f) => A.isMonetary(f.concept))).toBe(false)
    expect(section(sections, 'auditor').items).toEqual([])
    expect(auditors.columns.map((c) => c.concept)).toEqual(expect.arrayContaining(['in-ca:NameOfAuditFirm', AUDITOR_PAN, 'in-ca:MembershipNumberOfAuditor']))
    expect(section(sections, 'signatories').items.map((f) => f.concept)).toContain('in-ca:NameOfCompanySecretary')
  })

  it('offers the designation list as suggestions and a taxonomy enumeration as a strict list', () => {
    const designation = directors.columns.find((c) => c.concept === DESIGNATION)!
    expect(designation.strictOptions).toBe(false)
    expect(designation.options).toEqual(expect.arrayContaining(['Managing Director', 'Director', 'Company Secretary']))
    const category = auditors.columns.find((c) => c.concept === 'in-ca:CategoryOfAuditor')!
    expect(category).toMatchObject({ strictOptions: true, options: ['Individual', 'Auditors firm'] })
  })

  it('takes formats from the type pattern, a rule format assertion, or the curation', () => {
    const fmt = (q: string) => auditors.columns.concat(directors.columns).find((c) => c.concept === q)!.format
    expect(new RegExp(fmt(DIN)!.pattern).test('01234567')).toBe(true)
    expect(new RegExp(fmt(DIN)!.pattern).test('1234567')).toBe(false)
    expect(new RegExp(fmt(AUDITOR_PAN)!.pattern).test('AAKFJ6101B')).toBe(true) // C&I: a rule's format; Ind AS: the type
    expect(fmt('in-ca:MembershipNumberOfAuditor')).toEqual({ name: 'ICAI_MEMBERSHIP', pattern: FORMATS.ICAI_MEMBERSHIP.source })
  })

  it('writes card items and grid rows to the filing facts, CY', () => {
    const S = session(A)
    const company = () => masterItemValues(S, section(sections, 'company').items)
    setMasterItem(S, 'in-ca:NameOfCompany', '  Z Private Limited ')
    expect(company()['in-ca:NameOfCompany']).toBe('Z Private Limited')
    const member = nextMasterMember(S, directors.tableId, directors.axis)
    setMasterCell(S, directors.tableId, directors.axis, member, FIRST_NAME, 'Asha')
    setMasterCell(S, directors.tableId, directors.axis, member, DIN, '01234567')
    expect(masterTableRows(S, directors)).toEqual([{ member, values: { [FIRST_NAME]: 'Asha', [DIN]: '01234567' } }])
    setMasterCell(S, directors.tableId, directors.axis, member, DIN, '')
    expect(masterTableRows(S, directors)[0]!.values).toEqual({ [FIRST_NAME]: 'Asha' })
    removeMasterRow(S, directors.tableId, directors.axis, member)
    expect(masterTableRows(S, directors)).toEqual([])
    setMasterItem(S, 'in-ca:NameOfCompany', '')
    expect(company()).not.toHaveProperty('in-ca:NameOfCompany')
  })

  it('finds where a master fills by shared elements: the board report signatories, the group companies', () => {
    const own = sections.flatMap((s) => s.tables.map((t) => t.tableId))
    const fromDirectors = fillTargets(A_(A), directors.columns.map((c) => c.concept), own)
    const board = fromDirectors.find((t) => /SigningBoardReport/.test(t.tableId))!
    expect(board.shared).toEqual(expect.arrayContaining([FIRST_NAME, DESIGNATION, DIN]))
    expect(board.elrTitle).toBe('Disclosures - Directors report')
    const fromCompany = fillTargets(A_(A), section(sections, 'company').items.map((f) => f.concept), own)
    expect(fromCompany.find((t) => /ParticularsOfHolding/.test(t.tableId))!.shared).toEqual(['in-ca:NameOfCompany'])
  })

  it('fills a table from records once: a second fill adds nothing', () => {
    const S = session(A)
    const own = sections.flatMap((s) => s.tables.map((t) => t.tableId))
    const board = fillTargets(A_(A), [DIN], own).find((t) => /SigningBoardReport/.test(t.tableId))!
    const records: Record<string, string>[] = [{ [FIRST_NAME]: 'Asha', [DIN]: '01234567', 'in-ca:NotAColumn': 'x' }, { [FIRST_NAME]: 'Ravi', [DIN]: '07654321' }]
    const first = fillTableFromRecords(S, board.tableId, records)
    expect(first).toMatchObject({ skipped: 0 })
    expect(first.added).toHaveLength(2)
    expect(fillTableFromRecords(S, board.tableId, records)).toEqual({ added: [], skipped: 2 })
  })

  it('pairs the auditor PAN with its names by category', () => {
    const [pair] = panPairs(A_(A), auditors.columns.map((c) => c.concept))
    expect(pair!.byCategory['Auditors firm']).toEqual({ name: 'in-ca:NameOfAuditFirm', holder: 'F' })
    expect(panPairs(A_(A), [DIN])).toEqual([])
  })
})

describe.skipIf(!existsSync(DIXON))('masters on Dixon (Ind AS, MCA-accepted)', () => {
  const A = load('ind_as')
  const S = new Session(A, importXbrl(A, readFileSync(DIXON, 'utf8'), { fileName: 'dixon.xml' }).filing as never)
  const sections = masterSections(A_(A))

  it('reads back the company, its auditor and the directors signing the financial statements', () => {
    expect(masterItemValues(S, section(sections, 'company').items)['in-ca:NameOfCompany']).toBe('DIXON GLOBAL PRIVATE LIMITED')
    const [auditor] = masterTableRows(S, section(sections, 'auditor').tables[0]!)
    expect(auditor!.values['in-ca:NameOfAuditFirm']).toBe('JKVS & Co.')
    const directors = masterTableRows(S, tableWith(section(sections, 'signatories'), DIN))
    expect(directors.map((r) => r.values[FIRST_NAME])).toEqual(['Kishore', 'Saurabh'])
  })

  it("the auditor's PAN agrees with the firm's name", () => {
    const [auditor] = masterTableRows(S, section(sections, 'auditor').tables[0]!)
    const v = auditor!.values
    expect(panNameProblems(v[AUDITOR_PAN]!, v['in-ca:NameOfAuditFirm']!, 'F')).toEqual([])
  })
})

describe('format and PAN checks', () => {
  const PAN = { name: 'PAN', pattern: FORMATS.PAN.source }
  it('explains a value that does not have its format, and accepts empty values', () => {
    expect(formatProblem(PAN, 'AAKFJ6101B')).toBeNull()
    expect(formatProblem(PAN, '')).toBeNull()
    expect(formatProblem(null, 'anything')).toBeNull()
    expect(formatProblem(PAN, 'aakfj6101b')).toMatch(/in capitals/)
    expect(formatProblem({ name: 'in-ca-types:DINNumber', pattern: '^(?:[0-9]{8})$' }, '123')).toBe('Expected 8 digits.')
    expect(formatProblem({ name: 'ICAI_MEMBERSHIP', pattern: FORMATS.ICAI_MEMBERSHIP.source }, '22973')).toMatch(/6 digits/)
  })

  it('checks the PAN holder type and initial against the name', () => {
    expect(panNameProblems('AAKFJ6101B', 'JKVS & Co.', 'F')).toEqual([])
    expect(panNameProblems('ABCPS1234K', 'Ravi Kumar Sharma', 'P')).toEqual([])
    expect(panNameProblems('AAKFJ6101B', 'Jatin Kumar', 'P')).toEqual([
      'This PAN belongs to a firm / LLP, not an individual.',
      "The PAN's 5th character is J, but the surname starts with K.",
    ])
    expect(panNameProblems('AAKFJ6101B', 'M/s JKVS & Co.', 'F')).toEqual(["The PAN's 5th character is J, but the name starts with M."])
    expect(panNameProblems('not a pan', 'x', 'F')).toEqual([])
  })

  it('knows every format the knowledge base curates', () => {
    for (const kb of ['ci', 'ind_as']) {
      const formats = json(KB(`${kb}_engine_rules.json`)).businessRules.masters.formats as Record<string, string>
      for (const name of Object.values(formats)) expect(FORMATS).toHaveProperty(name)
    }
  })
})
