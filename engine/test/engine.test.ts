import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Authority, Session, Filing, buildExample, explainMcaErrors, decimal, fillMandatoryZeros, mandatoryZeroPlan } from '../src/index'

const AUTH = new URL('../authority/ci-2016.authority.json', import.meta.url)
const hasAuthority = existsSync(AUTH)

describe.skipIf(!hasAuthority)('engine facade on the compiled C&I 2016 authority', () => {
  const A = hasAuthority ? new Authority(JSON.parse(readFileSync(AUTH, 'utf8'))) : (null as never)
  const exampleXml = () => {
    const S = new Session(A)
    buildExample(S)
    return { S, out: S.exportXml({ today: '2017-09-30' }) }
  }

  it('builds the example filing, validates it without blocking errors and exports XML', () => {
    const { S, out } = exampleXml()
    const errors = S.validate({ today: '2017-09-30' }).issues.filter((i: { severity: string }) => i.severity === 'ERROR')
    expect(errors).toEqual([])
    expect(out.xml).toContain('https://www.mca.gov.in/V3XBRL/2016/07/26/Taxonomy/CnI/in-ci-ent-2016-03-31.xsd')
    expect(out.xml).toContain('<xbrli:identifier scheme="http://www.mca.gov.in/CIN">U72200KA2010PTC123456</xbrli:identifier>')
    expect(out.xml).not.toContain('precision=')
  })

  it('reports a statement’s empty mandatory amounts as 0, never overwriting a value or touching text', () => {
    const S = new Session(A)
    S.setMeta({ name: 'Z Ltd', cin: 'U72200KA2010PTC123456', reportType: 'Standalone', level: 'Lakhs', statementPlaces: 2, displayPlaces: 7,
      periods: { cy: { start: '2025-04-01', end: '2026-03-31' }, py: { start: '2024-04-01', end: '2025-03-31' } } })
    S.setValue('in-gaap:LongTermBorrowings', 'CY', '12.5')
    const plan = mandatoryZeroPlan(S, '100100')
    expect(plan.map((z: { concept: string; scope: string }) => `${z.concept} ${z.scope}`)).toContain('in-gaap:LongTermBorrowings PY')
    expect(plan.some((z: { concept: string; scope: string }) => z.concept === 'in-gaap:LongTermBorrowings' && z.scope === 'CY')).toBe(false)
    expect(plan.every((z: { concept: string }) => A.dataType(z.concept) === 'monetary')).toBe(true)
    expect(fillMandatoryZeros(S, '100100')).toEqual(plan)
    expect(S.getValue('in-gaap:LongTermBorrowings', 'PY').value).toBe('0')
    expect(S.getValue('in-gaap:LongTermBorrowings', 'CY').value).toBe('1250000')
    expect(mandatoryZeroPlan(S, '100100')).toEqual([])
  })

  it('is deterministic: the same filing gives byte-identical XML', () => {
    expect(exampleXml().out.xml).toBe(exampleXml().out.xml)
  })

  it('round-trips a filing through toJSON / fromJSON', () => {
    const { S } = exampleXml()
    const json = JSON.parse(JSON.stringify(S.filing.toJSON()))
    const S2 = new Session(A, Filing.fromJSON(A, json))
    expect(S2.exportXml({ today: '2017-09-30' }).xml).toBe(S.exportXml({ today: '2017-09-30' }).xml)
  })

  it('explains an MCA validator (Xerces) error', () => {
    const out = explainMcaErrors("cvc-pattern-valid: Value 'ABCDE1234' is not facet-valid with respect to pattern '[A-Z]{5}[0-9]{4}[A-Z]' for type 'PANNumber'.")
    expect(out.length).toBeGreaterThan(0)
  })

  it('does exact decimal arithmetic (no float drift)', () => {
    expect(decimal.toString(decimal.add(decimal.parse('0.1'), decimal.parse('0.2')))).toBe('0.3')
  })
})

describe.skipIf(!hasAuthority)('indexFactLines', () => {
  it('points every emitted fact at its own XML line', async () => {
    const { indexFactLines } = await import('../src/index')
    const A = new Authority(JSON.parse(readFileSync(AUTH, 'utf8')))
    const S = new Session(A)
    buildExample(S)
    const out = S.exportXml({ today: '2017-09-30' })
    const index = indexFactLines(out.xml, S.filing, out.gate.emit)
    const lines = out.xml.split('\n')
    expect(Object.keys(index).length).toBe(out.gate.emit.length)
    for (const f of out.gate.emit as { key: string; concept: string }[]) {
      expect(lines[index[f.key]! - 1]).toContain(`<${f.concept} `)
    }
  })
})
