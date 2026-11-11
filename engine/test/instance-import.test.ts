/**
 * Phase 7 golden: the MCA-accepted Dixon instance (Ind AS, Webtel v32.7, FY 2025-26) is imported into a filing and
 * regenerated; every one of its 2,666 facts comes back with the same meaning (concept, period, dimensions, unit,
 * decimals, value). Real client data: it stays in this process (docs/12-reference-data.md).
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assembleAuthority, Authority, buildExample, compareInstanceFacts, importXbrl, instanceConventions, readSchemaRef, Session, verifyRoundTrip } from '../src/index'

const DIXON = new URL('../../data/Instance_Dixon_Global_Private_2025-26_001.xml', import.meta.url)
const IND_AS = new URL('../../knowledge_base/ind_as_engine_authority.json', import.meta.url)
const CI = new URL('../authority/ci-2016.authority.json', import.meta.url)
const TODAY = '2026-11-10'

describe.skipIf(!existsSync(DIXON) || !existsSync(IND_AS))('Dixon (Ind AS, Webtel) import → regenerate', () => {
  const xml = existsSync(DIXON) ? readFileSync(DIXON, 'utf8') : ''
  const A = existsSync(IND_AS) ? new Authority(assembleAuthority(JSON.parse(readFileSync(IND_AS, 'utf8')), null)) : (null as never)

  it('imports every fact and detects the periods and the schemaRef', () => {
    const { report } = importXbrl(A, xml, { fileName: 'dixon.xml' })
    expect(report.counts).toMatchObject({ sourceFacts: 2666, imported: 2666, unresolved: 0, footnotes: 28 })
    expect(report.schemaRefMatches).toBe(true)
    expect(report.periodDetection.cy).toEqual({ start: '2025-04-01', end: '2026-03-31' })
    expect(readSchemaRef(xml)).toBe('https://www.mca.gov.in/V3XBRL/2017/07/16/Taxonomy/Ind/in-ci-ent-2017-03-31.xsd')
  })

  it('regenerates all 2,666 facts with the same meaning (golden)', () => {
    const { filing } = importXbrl(A, xml, { fileName: 'dixon.xml' })
    const cmp = verifyRoundTrip(A, filing, xml, TODAY)
    expect({ missing: cmp.missing, extra: cmp.extra, changed: cmp.changed }).toEqual({ missing: [], extra: [], changed: [] })
    expect(cmp).toMatchObject({ sourceFacts: 2666, regeneratedFacts: 2666, equal: 2666, identical: true })
  })

  it('records the vendor conventions that differ from ours without changing the facts', () => {
    const { filing } = importXbrl(A, xml, { fileName: 'dixon.xml' })
    const ours = instanceConventions(new Session(A, filing as never).exportXml({ today: TODAY, allowErrors: true }).xml)
    const theirs = instanceConventions(xml)
    expect(theirs).toMatchObject({ contextIdStyle: 'descriptive', duplicateContexts: 2, contexts: 346, factsWithId: 2666, footnotes: 28 })
    expect(theirs.generator).toMatch(/Webtel/)
    expect(ours).toMatchObject({ contextIdStyle: 'short', duplicateContexts: 0, contexts: 344, facts: 2666, footnotes: 28 })
  })

  it('starts next year from it: this year becomes the previous year', () => {
    const { filing, report } = importXbrl(A, xml, { fileName: 'dixon.xml', mode: 'next' })
    const meta = (filing as { meta: { periods: unknown } }).meta
    expect(meta.periods).toEqual({ cy: { start: '2026-04-01', end: '2027-03-31' }, py: { start: '2025-04-01', end: '2026-03-31' } })
    expect(report.byYear.previous).toBe(1427)
    expect(report.byYear.skippedPrevious).toBe(1195)
  })

  it('a changed value is reported, not hidden', () => {
    const tampered = xml.replace(/(<ind-as:EquityShareCapital [^>]*>)10000000</, '$110000001<')
    const cmp = compareInstanceFacts(xml, tampered)
    expect(cmp.identical).toBe(false)
    expect(cmp.changed).toHaveLength(1)
    expect(cmp.changed[0]!.key).toMatch(/^ind-as:EquityShareCapital\|/)
  })
})

describe('malformed input', () => {
  it('reports XML that is not well formed instead of importing nothing silently', () => {
    expect(() => compareInstanceFacts('<xbrli:xbrl', '<x/>')).toThrow(/well-formed/)
  })
})

describe.skipIf(!existsSync(CI))('C&I round trip', () => {
  it('the example filing survives export → import → export', () => {
    const A = new Authority(JSON.parse(readFileSync(CI, 'utf8')))
    const S = new Session(A)
    buildExample(S)
    const xml = S.exportXml({ today: '2017-09-30' }).xml
    const { filing, report } = importXbrl(A, xml)
    expect(report.counts.unresolved).toBe(0)
    expect(verifyRoundTrip(A, filing, xml, '2017-09-30').identical).toBe(true)
  })
})
