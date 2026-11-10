import { describe, expect, it } from 'vitest'
import { ENGINE_VERSION, isValidCin, SUPPORTED_TAXONOMIES } from '../src/index'

describe('@xap/engine skeleton', () => {
  it('exposes a version', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('marks only C&I 2016 as v1', () => {
    expect(SUPPORTED_TAXONOMIES.filter((t) => t.v1).map((t) => t.id)).toEqual(['ci-2016'])
  })

  it('validates CIN like the legacy FORMATS.CIN', () => {
    expect(isValidCin('U12345MH2010PTC123456')).toBe(true)
    expect(isValidCin(' l12345mh2010plc123456 ')).toBe(true)
    expect(isValidCin('X12345MH2010PTC123456')).toBe(false)
    expect(isValidCin('U12345MH2010PTC12345')).toBe(false)
  })
})
