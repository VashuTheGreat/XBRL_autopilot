/**
 * The amount a cell contributes to the filing, at the precision the statement shows.
 *
 * Excel formulas leave binary float noise (HPL: `5443.466337358575` lakhs where the statement prints 5,443.47).
 * A numeric cell is rounded (half away from zero, engine decimals, never JS floats) to the decimal places of its
 * number format, or to the filing's "decimal places as presented" when the cell has no number format.
 * Text cells are what the accountant typed: they are never rounded.
 */
import { decimal as Dec } from '@xap/engine'
import type { CellAmount } from '@shared/editor'
import type { CellModel } from '@shared/workbook'
import { parseAmount } from './amounts'

/**
 * Decimal places an Excel number format displays: "#,##0.00" → 2, "0" → 0, "0.0%" → 3, "General"/"@"/dates → null.
 * Only the positive section counts; literals, colours/conditions, padding and fill characters are ignored.
 */
export function formatPlaces(numFmt: string | undefined): number | null {
  if (!numFmt) return null
  const section = (numFmt.split(';')[0] ?? '')
    .replace(/"[^"]*"/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\\./g, '')
    .replace(/[_*]./g, '')
  if (!/[0#?]/.test(section) || /[ymdhs]/i.test(section)) return null
  const frac = /\.([0#?]+)/.exec(section)?.[1]?.length ?? 0
  const percent = (section.match(/%/g) ?? []).length * 2
  return frac + percent
}

/** null when the cell holds no amount (text, blank, "-", "Nil"). */
export function cellAmount(cell: Pick<CellModel, 'v' | 'numFmt'>, filingPlaces: number): CellAmount | null {
  const exact = parseAmount(cell.v)
  if (exact === null) return null
  if (typeof cell.v !== 'number') {
    return { exact, value: exact, places: Dec.fractionDigits(Dec.parse(exact)), placesFrom: 'typed', rounded: false }
  }
  const fromFormat = formatPlaces(cell.numFmt)
  const places = fromFormat ?? filingPlaces
  const value = Dec.toString(Dec.round(Dec.parse(exact), places))
  return {
    exact: String(cell.v),
    value,
    places,
    placesFrom: fromFormat === null ? 'filing' : 'format',
    rounded: !Dec.eq(Dec.parse(value), Dec.parse(cell.v)),
  }
}
