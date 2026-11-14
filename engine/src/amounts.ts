/**
 * Exact sums of filed amounts (decimal strings, never JS floats): a fact tagged from several Excel sources
 * (ADR-0015) files Σ of their amounts.
 */
import * as Dec from './core/decimal.js'

/**
 * Σ amounts, exact, written to the finest places among them so no stated digit is dropped:
 * ["1234.50", "10", "-0.25"] → "1244.25", ["1000.50", "99.50"] → "1100.00".
 */
export function sumAmounts(amounts: readonly string[]): string {
  if (!amounts.length) throw new Error('Nothing to add up')
  const places = Math.max(...amounts.map(statedPlaces))
  return Dec.toFixed(Dec.sum(amounts.map((a) => Dec.parse(a))), places)
}

/** "1000.50" → 2 (the written places, trailing zeros included). */
function statedPlaces(amount: string): number {
  const frac = /\.(\d*)$/.exec(amount.trim())
  return frac ? frac[1]!.length : 0
}
