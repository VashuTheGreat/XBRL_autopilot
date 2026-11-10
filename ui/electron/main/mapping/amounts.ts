/**
 * Turns what accountants type in Excel into a canonical decimal string for the engine.
 *   60000000 → "60000000"   "(1,23,456.50)" → "-123456.50"   "Rs. 1,000" → "1000"   "₹ 2,500" → "2500"
 *   "-" / "" / "Nil" → null (no value)   -343854 → "-343854"
 * Never uses floating-point arithmetic on the digits.
 */
import type { CellValue } from '@shared/workbook'

const BLANK = /^(?:-+|–|—|nil|n\.?a\.?|none)$/i

export function parseAmount(v: CellValue): string | null {
  if (v === null || typeof v === 'boolean') return null
  if (typeof v === 'number') return Number.isFinite(v) ? numberToDecimal(v) : null
  let s = v.trim()
  if (!s || BLANK.test(s)) return null
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  // "Dr"/"Cr" suffixes are stripped: whether a debit is positive depends on the line (asset vs liability),
  // so the sign is the mapping's job (MappingEntry.sign), not the parser's.
  s = s.replace(/^(?:rs\.?|inr|₹)\s*/i, '').replace(/\s*(?:dr|cr)\.?$/i, '')
  s = s.replace(/[,\s]/g, '')
  if (s.startsWith('-')) {
    negative = !negative
    s = s.slice(1)
  }
  if (!/^\d+(?:\.\d+)?$/.test(s)) return null
  s = s.replace(/^0+(?=\d)/, '')
  return negative && !/^0(?:\.0+)?$/.test(s) ? `-${s}` : s
}

/** Exact decimal text of a JS number, without exponent notation (Excel stores up to 15 significant digits). */
function numberToDecimal(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < Number.MAX_SAFE_INTEGER) return String(n)
  const s = n.toPrecision(15)
  if (!/e/i.test(s)) return trimZeros(s)
  // exponent form: let BigInt-free string math expand it
  const [mant, expStr] = s.toLowerCase().split('e')
  const exp = Number(expStr)
  const neg = mant!.startsWith('-')
  const [int, frac = ''] = mant!.replace('-', '').split('.')
  const digits = int! + frac
  const point = int!.length + exp
  const out =
    point <= 0 ? `0.${'0'.repeat(-point)}${digits}` : point >= digits.length ? digits + '0'.repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`
  return (neg ? '-' : '') + trimZeros(out)
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

/** Applies a sign (+1/-1) to a canonical decimal string. */
export function withSign(amount: string, sign: 1 | -1): string {
  if (sign === 1 || /^0(?:\.0+)?$/.test(amount)) return amount
  return amount.startsWith('-') ? amount.slice(1) : `-${amount}`
}
