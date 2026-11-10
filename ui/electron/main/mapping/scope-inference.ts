/**
 * Works out whether a value cell is the current year (CY) or previous year (PY) from its column header.
 * Headers seen in Indian financial statements: "31.03.2014", "31-03-2014", "31st March, 2014", "As at 31 March 2014",
 * "2013-14", "FY 2013-14", "Current Year", "Previous Year", an Excel date, or just "2014".
 */
import type { Scope } from '@shared/editor'
import type { SheetModel } from '@shared/workbook'

export interface Periods {
  cy: { start: string; end: string }
  py: { start: string; end: string } | null
}

export interface ScopeGuess {
  scope: Scope
  /** what the decision was based on, shown in the UI */
  reason: string
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** Year-end dates (yyyy-mm-dd) a header refers to, or a bare fiscal-year end year. */
function datesIn(text: string): { iso: string[]; fyEndYears: number[] } {
  const t = text.toLowerCase()
  const iso: string[] = []
  const pad = (n: number) => String(n).padStart(2, '0')
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) iso.push(`${m[1]}-${m[2]}-${m[3]}`)
  for (const m of t.matchAll(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/g)) iso.push(`${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`)
  for (const m of t.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})\b/g)) {
    const mi = MONTHS.indexOf(m[2]!)
    if (mi >= 0) iso.push(`${m[3]}-${pad(mi + 1)}-${pad(Number(m[1]))}`)
  }
  for (const m of t.matchAll(/\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g)) {
    const mi = MONTHS.indexOf(m[1]!)
    if (mi >= 0) iso.push(`${m[3]}-${pad(mi + 1)}-${pad(Number(m[2]))}`)
  }
  const fyEndYears: number[] = []
  for (const m of t.matchAll(/\b(?:fy\s*)?(\d{4})\s*[-–/]\s*(\d{2}|\d{4})\b/g)) {
    const start = Number(m[1])
    const endRaw = m[2]!
    const end = endRaw.length === 2 ? Math.floor(start / 100) * 100 + Number(endRaw) : Number(endRaw)
    if (end === start + 1) fyEndYears.push(end)
  }
  if (!iso.length && !fyEndYears.length) for (const m of t.matchAll(/\b(19|20)(\d{2})\b/g)) fyEndYears.push(Number(m[1]! + m[2]!))
  return { iso, fyEndYears }
}

function classify(text: string, p: Periods): Scope | null {
  const t = text.toLowerCase()
  if (/\b(current|this)\s+(year|period)\b/.test(t)) return 'CY'
  if (/\b(previous|prior|last|preceding)\s+(year|period)\b/.test(t)) return 'PY'
  const { iso, fyEndYears } = datesIn(text)
  if (iso.includes(p.cy.end)) return 'CY'
  if (p.py && iso.includes(p.py.end)) return 'PY'
  const cyYear = Number(p.cy.end.slice(0, 4))
  const pyYear = p.py ? Number(p.py.end.slice(0, 4)) : null
  if (fyEndYears.includes(cyYear) || iso.some((d) => Number(d.slice(0, 4)) === cyYear)) return 'CY'
  if (pyYear !== null && (fyEndYears.includes(pyYear) || iso.some((d) => Number(d.slice(0, 4)) === pyYear))) return 'PY'
  return null
}

/**
 * 1. The nearest header text above the cell in the same column that names a period of this filing.
 * 2. Otherwise the two value columns of the sheet: the left one is CY, the right one PY (the Schedule III layout).
 */
export function inferScope(sheet: SheetModel, at: { r: number; c: number }, periods: Periods): ScopeGuess | null {
  const above = sheet.cells
    .filter((x) => x.c === at.c && x.r < at.r && typeof x.v === 'string')
    .sort((a, b) => b.r - a.r)
  for (const h of above) {
    const s = classify(String(h.v), periods)
    if (s) return { scope: s, reason: `column header “${String(h.v).trim()}”` }
  }
  // value columns = columns with at least 3 numbers that are not small integers (note numbers)
  const counts = new Map<number, number>()
  for (const x of sheet.cells) if (typeof x.v === 'number' && !(Number.isInteger(x.v) && Math.abs(x.v) < 100)) counts.set(x.c, (counts.get(x.c) ?? 0) + 1)
  const valueCols = [...counts.entries()].filter(([, n]) => n >= 3).map(([c]) => c).sort((a, b) => a - b)
  if (valueCols.length === 2 && valueCols.includes(at.c)) {
    if (!periods.py && at.c === valueCols[1]) return null
    return { scope: at.c === valueCols[0] ? 'CY' : 'PY', reason: 'first value column = current year, second = previous year' }
  }
  return null
}
