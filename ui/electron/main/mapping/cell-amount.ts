/**
 * The amount a cell (or a range of cells) contributes to the filing, at the precision the statement shows.
 *
 * Excel formulas leave binary float noise (HPL: `5443.466337358575` lakhs where the statement prints 5,443.47).
 * - statement figures: a numeric cell is rounded (half away from zero, engine decimals, never JS floats) to the decimal
 *   places of its number format, else to the filing's "decimal places as presented";
 * - actual values (share capital, which MCA wants exact): rounded only to `places` (exact rupees), whatever the format
 *   shows. HPL files share capital 4.1783 lakhs although the cell format shows 4.18.
 * Text cells are what the accountant typed: they are never rounded. A range is summed exactly, then rounded once.
 */
import { decimal as Dec } from '@xap/engine'
import type { CellAmount } from '@shared/editor'
import type { CellModel } from '@shared/workbook'
import { parseAmount } from './amounts'

export type AmountPrecision = { kind: 'statement'; fallbackPlaces: number } | { kind: 'actual'; places: number }

type AmountCell = Pick<CellModel, 'v' | 'numFmt'>

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
export function cellAmount(cell: AmountCell, precision: AmountPrecision): CellAmount | null {
  return rangeAmount([cell], precision)
}

/** Sum of the cells' amounts (blank and "-" cells count as nothing); null when none holds an amount. */
export function rangeAmount(cells: readonly (AmountCell | null | undefined)[], precision: AmountPrecision): CellAmount | null {
  const parts = cells.flatMap((c) => {
    const exact = c ? parseAmount(c.v) : null
    return c && exact !== null ? [{ cell: c, exact }] : []
  })
  if (!parts.length) return null
  // what Excel stores: numbers as they are (float noise included), text as parsed
  const stored = Dec.sum(parts.map((p) => Dec.parse(typeof p.cell.v === 'number' ? p.cell.v : p.exact)))
  const exact = Dec.toString(stored)
  const numeric = parts.filter((p) => typeof p.cell.v === 'number')
  if (!numeric.length) {
    // typed text only: never rounded
    const typed = Dec.toString(Dec.sum(parts.map((p) => Dec.parse(p.exact))))
    return { exact: typed, value: typed, places: Dec.fractionDigits(Dec.parse(typed)), placesFrom: 'typed', rounded: false }
  }
  let places: number
  let placesFrom: CellAmount['placesFrom']
  if (precision.kind === 'actual') {
    places = precision.places
    placesFrom = 'actual'
  } else {
    const fromFormat = numeric.map((p) => formatPlaces(p.cell.numFmt)).find((n) => n !== null) ?? null
    places = fromFormat ?? precision.fallbackPlaces
    placesFrom = fromFormat === null ? 'filing' : 'format'
  }
  // 15 significant digits first (Excel's precision): 3.9021999999999997 is 3.9022, not 3.90219…
  const clean = Dec.sum(parts.map((p) => Dec.parse(p.exact)))
  const value = Dec.toString(Dec.round(clean, places))
  return { exact, value, places, placesFrom, rounded: !Dec.eq(Dec.parse(value), stored) }
}

