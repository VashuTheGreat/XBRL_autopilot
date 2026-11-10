/**
 * ADR-0010: the engine authority = taxonomy authority from the knowledge base (Python ingestion, served by the
 * sidecar route) + business rules compiled by engine/compiler. Golden check: the example filing exported with the
 * route-built C&I authority is byte-identical to the XML exported with the retired TypeScript DTS compiler's
 * authority (fixture written from it on 2026-11-10).
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assembleAuthority, Authority, AuthorityMismatchError, buildExample, Session } from '../src/index'

const KB = (f: string) => new URL(`../../knowledge_base/${f}`, import.meta.url)
const CI_TAXONOMY = KB('ci_engine_authority.json')
const IND_AS_TAXONOMY = KB('ind_as_engine_authority.json')
const CI_RULES = new URL('../authority/ci-2016.rules.json', import.meta.url)
const GOLDEN = new URL('./fixtures/ci-2016-example.golden.xml', import.meta.url)
const json = (u: URL) => JSON.parse(readFileSync(u, 'utf8'))

describe.skipIf(!existsSync(CI_TAXONOMY) || !existsSync(CI_RULES))('C&I 2016 authority from the knowledge base', () => {
  const taxonomy = existsSync(CI_TAXONOMY) ? json(CI_TAXONOMY) : null
  const rules = existsSync(CI_RULES) ? json(CI_RULES) : null

  it('exports the example filing byte-identical to the TS-compiled authority (golden)', () => {
    const S = new Session(new Authority(assembleAuthority(taxonomy, rules)))
    buildExample(S)
    const out = S.exportXml({ today: '2017-09-30' })
    expect(out.xml).toBe(readFileSync(GOLDEN, 'utf8'))
  })

  it('carries the taxonomy build and rule hashes', () => {
    const a = assembleAuthority(taxonomy, rules)
    expect(a.meta.taxonomyHash).toBe(taxonomy.meta.taxonomyHash)
    expect(a.meta.authorityHash).toBe(rules.meta.authorityHash)
    expect(a.businessRules.rules.length).toBeGreaterThan(1000)
  })

  it('refuses rules compiled against another taxonomy build', () => {
    const stale = { ...rules, meta: { ...rules.meta, taxonomyHash: 'f'.repeat(64) } }
    expect(() => assembleAuthority(taxonomy, stale)).toThrow(AuthorityMismatchError)
  })
})

describe.skipIf(!existsSync(IND_AS_TAXONOMY))('Ind AS 2017 authority from the knowledge base (no compiled rules yet)', () => {
  const A = existsSync(IND_AS_TAXONOMY) ? new Authority(assembleAuthority(json(IND_AS_TAXONOMY), null)) : (null as never)
  const session = () => {
    const S = new Session(A)
    S.setMeta({ name: 'Z Ltd', cin: 'U51900UP2010PTC042400', reportType: 'Standalone', level: 'Lakhs', statementPlaces: 2, displayPlaces: 7,
      periods: { cy: { start: '2025-04-01', end: '2026-03-31' }, py: { start: '2024-04-01', end: '2025-03-31' } } })
    return S
  }

  it('has the Ind AS concepts, statements and tables', () => {
    expect(A.qnameOfLocal('EquityShareCapital')).toBe('ind-as:EquityShareCapital')
    expect(A.elrs.length).toBeGreaterThan(50)
    expect(A.tables.length).toBe(A.meta.relationshipStats.all)
    expect(A.rules.rules).toEqual([])
  })

  it('exports with the Ind AS schemaRef and namespaces', () => {
    const S = session()
    S.setValue(A.qnameOfLocal('NameOfCompany')!, 'CY', 'Z Ltd')
    S.setValue('ind-as:Assets', 'CY', '100.5')
    const { xml } = S.exportXml({ today: '2026-11-10' })
    expect(xml).toContain('xlink:href="https://www.mca.gov.in/V3XBRL/2017/07/16/Taxonomy/Ind/in-ci-ent-2017-03-31.xsd"')
    expect(xml).toContain('xmlns:ind-as="http://www.icai.org/xbrl/taxonomy/2017-03-31/ind-as"')
    expect(xml).toMatch(/<ind-as:Assets [^>]*>10050000</)
  })

  it('files equity share capital at its actual value, like C&I share capital', () => {
    const S = session()
    S.setValue('ind-as:EquityShareCapital', 'CY', '4.1783')
    expect(S.getValue('ind-as:EquityShareCapital', 'CY').value).toBe('417830')
  })
})
