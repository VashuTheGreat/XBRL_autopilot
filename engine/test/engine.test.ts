import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Authority, Session, Filing, buildExample, explainMcaErrors, decimal } from '../src/index'

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
