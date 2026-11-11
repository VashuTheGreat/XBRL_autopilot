/** Workbook model (what the Excel pane shows) + cell reference helpers. Pure: shared by main and renderer. */

export interface CellRef {
  /** source name inside the project, e.g. "workbook-1.xlsx" */
  workbook: string
  sheet: string
  /** A1 reference, e.g. "C9" */
  ref: string
}

export type CellValue = string | number | boolean | null

export interface CellModel {
  /** 0-based row / column */
  r: number
  c: number
  v: CellValue
  /** formula without "=", when the cell had one (v is its cached result) */
  f?: string
  bold?: boolean
  italic?: boolean
  indent?: number
  numFmt?: string
}

export interface SheetModel {
  name: string
  rowCount: number
  colCount: number
  cells: CellModel[]
  merges: { r1: number; c1: number; r2: number; c2: number }[]
  /** 0-based column → width in Excel character units */
  colWidths: Record<number, number>
  /** set when the sheet was too large to show whole (a working-paper dump): only the first rows are kept */
  truncated?: { totalCells: number; keptRows: number }
}

export interface WorkbookModel {
  source: string
  fileName: string
  sheets: SheetModel[]
}

export function columnLetter(c: number): string {
  let s = ''
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

export function toA1(r: number, c: number): string {
  return `${columnLetter(c)}${r + 1}`
}

/** "C9" → { r: 8, c: 2 }; null for anything that isn't a single A1 cell. */
export function fromA1(ref: string): { r: number; c: number } | null {
  const m = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/.exec(ref.toUpperCase())
  if (!m) return null
  let c = 0
  for (const ch of m[1]!) c = c * 26 + (ch.charCodeAt(0) - 64)
  return { r: Number(m[2]) - 1, c: c - 1 }
}

export function cellKey(ref: CellRef): string {
  return `${ref.workbook}|${ref.sheet}|${ref.ref}`
}

export function sameCell(a: CellRef | null | undefined, b: CellRef | null | undefined): boolean {
  return !!a && !!b && a.workbook === b.workbook && a.sheet === b.sheet && a.ref === b.ref
}

export interface CellRange {
  r1: number
  c1: number
  r2: number
  c2: number
}

/** "C9" or "D22:D23" (either corner order) → normalised 0-based range; null for anything else. */
export function rangeOf(ref: string): CellRange | null {
  const [a, b, extra] = ref.split(':')
  if (extra !== undefined || !a) return null
  const p = fromA1(a)
  const q = b === undefined ? p : fromA1(b)
  if (!p || !q) return null
  return { r1: Math.min(p.r, q.r), c1: Math.min(p.c, q.c), r2: Math.max(p.r, q.r), c2: Math.max(p.c, q.c) }
}

/** A1 of a range: "C9" for one cell, "D22:D23" otherwise. */
export function rangeA1(g: CellRange): string {
  const a = toA1(g.r1, g.c1)
  return g.r1 === g.r2 && g.c1 === g.c2 ? a : `${a}:${toA1(g.r2, g.c2)}`
}

/**
 * Largest range the app expands into cells. A whole-column or whole-sheet selection is ~10⁶–10¹⁰ cells: expanding it
 * crashed the renderer (out of memory, black window).
 */
export const MAX_RANGE_CELLS = 1000

/** The largest range "Map as table" maps to one taxonomy table (ADR-0013). */
export const MAX_BLOCK_CELLS = 5_000

/** Number of cells in a reference, computed (never expanded); 0 when it isn't one. */
export function rangeSize(ref: string): number {
  const g = rangeOf(ref)
  return g ? (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1) : 0
}

/** Every cell of a reference, as A1 ("D22:D23" → ["D22", "D23"]); [] beyond MAX_RANGE_CELLS. */
export function rangeCells(ref: string): string[] {
  const g = rangeOf(ref)
  if (!g || rangeSize(ref) > MAX_RANGE_CELLS) return []
  const out: string[] = []
  for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) out.push(toA1(r, c))
  return out
}

/** Do two references on the same workbook and sheet share a cell? */
export function overlaps(a: CellRef, b: CellRef): boolean {
  if (a.workbook !== b.workbook || a.sheet !== b.sheet) return false
  const p = rangeOf(a.ref)
  const q = rangeOf(b.ref)
  return !!p && !!q && p.r1 <= q.r2 && q.r1 <= p.r2 && p.c1 <= q.c2 && q.c1 <= p.c2
}
