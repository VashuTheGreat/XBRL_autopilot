import { describe, expect, it } from 'vitest'
import { ENGINE_VERSION, isFilingTaxonomy, isValidCin, SUPPORTED_TAXONOMIES } from '../src/index'

describe('@xap/engine skeleton', () => {
  it('exposes a version', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('files C&I 2016 and Ind AS 2017 in v1 (ADR-0007), not Costing yet', () => {
    expect(SUPPORTED_TAXONOMIES.filter((t) => t.v1).map((t) => t.id)).toEqual(['ci-2016', 'ind-as-2017'])
    expect(isFilingTaxonomy('ind-as-2017')).toBe(true)
    expect(isFilingTaxonomy('costing-2019')).toBe(false)
    expect(isFilingTaxonomy('nope')).toBe(false)
  })

  it('validates CIN like the legacy FORMATS.CIN', () => {
    expect(isValidCin('U12345MH2010PTC123456')).toBe(true)
    expect(isValidCin(' l12345mh2010plc123456 ')).toBe(true)
    expect(isValidCin('X12345MH2010PTC123456')).toBe(false)
    expect(isValidCin('U12345MH2010PTC12345')).toBe(false)
  })
})
