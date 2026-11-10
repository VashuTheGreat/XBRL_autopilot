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
