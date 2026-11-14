import { describe, expect, it } from 'vitest'
import { sumAmounts } from '../src/amounts'

describe('sumAmounts: exact sums of filed amounts (ADR-0015)', () => {
  it('adds decimal strings exactly, at the finest stated places', () => {
    expect(sumAmounts(['1234.50', '10', '-0.25'])).toBe('1244.25')
    expect(sumAmounts(['1000.50', '99.50'])).toBe('1100.00')
    expect(sumAmounts(['60000000'])).toBe('60000000')
  })

  it('has none of the float errors (0.1 + 0.2)', () => {
    expect(sumAmounts(['0.1', '0.2'])).toBe('0.3')
    expect(sumAmounts(['99999999999999.99', '0.01'])).toBe('100000000000000.00')
  })

  it('handles signs: a source reversed in sign subtracts', () => {
    expect(sumAmounts(['500', '-700'])).toBe('-200')
  })

  it('refuses an empty list', () => {
    expect(() => sumAmounts([])).toThrow()
  })
})
