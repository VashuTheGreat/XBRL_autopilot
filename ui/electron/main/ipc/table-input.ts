/**
 * Validation of the table-tagging inputs that arrive from the renderer (ADR-0013): only the expected fields, with the
 * expected types, are kept. The services and the engine check the meaning (members of the table, periods, …).
 */
import type { AlsoReportInput, DimRef, Scope, TableBlockColumnInput, TableBlockInput, TableBlockRowInput, TagCellInput } from '@shared/editor'
import type { CellRef } from '@shared/workbook'
import { requireString } from './handle'

const SCOPES: Scope[] = ['CY', 'PY']
const MAX_ITEMS = 2_000

export function requireCell(v: unknown): CellRef {
  const c = v as Partial<CellRef> | null
  if (!c || typeof c !== 'object') throw new Error('Invalid cell')
  return { workbook: requireString(c.workbook, 'workbook'), sheet: requireString(c.sheet, 'sheet'), ref: requireString(c.ref, 'cell reference') }
}

const optScope = (v: unknown): Scope | undefined => {
  if (v === undefined || v === null) return undefined
  if (!SCOPES.includes(v as Scope)) throw new Error('Invalid scope')
  return v as Scope
}
const optLabel = (v: unknown): string | null | undefined => (v === undefined ? undefined : v === null ? null : requireString(v, 'label role'))
const index = (v: unknown, what: string): number => {
  if (!Number.isInteger(v) || (v as number) < 0) throw new Error(`Invalid ${what}`)
  return v as number
}

/** A position in a list (an "also reported as" fact of a cell). */
export const requireIndex = (v: unknown): number => index(v, 'index')
const list = <T>(v: unknown, what: string, item: (x: unknown) => T): T[] => {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v) || v.length > MAX_ITEMS) throw new Error(`Invalid ${what}`)
  return v.map(item)
}

export function requireDims(v: unknown): DimRef[] {
  return list(v, 'members', (x) => {
    const d = x as Partial<DimRef> | null
    if (!d || typeof d !== 'object') throw new Error('Invalid member')
    const axis = requireString(d.axis, 'axis')
    if (typeof d.member === 'string' && d.member) return { axis, member: d.member }
    if (typeof d.typed === 'string' && d.typed.trim()) return { axis, typed: d.typed.slice(0, 500) }
    throw new Error('A member needs an explicit member or a typed value')
  })
}

export function requireTagInput(v: unknown): TagCellInput {
  const x = v as Partial<TagCellInput> | null
  if (!x || typeof x !== 'object') throw new Error('Invalid tag request')
  const scope = optScope(x.scope)
  const preferredLabel = optLabel(x.preferredLabel)
  return {
    cell: requireCell(x.cell),
    concept: requireString(x.concept, 'element'),
    ...(scope ? { scope } : {}),
    ...(x.sign === -1 || x.sign === 1 ? { sign: x.sign } : {}),
    ...(x.dims !== undefined ? { dims: requireDims(x.dims) } : {}),
    ...(typeof x.tableId === 'string' ? { tableId: x.tableId } : {}),
    ...(preferredLabel !== undefined ? { preferredLabel } : {}),
  }
}

export function requireAlsoInput(v: unknown): AlsoReportInput {
  const x = v as Partial<AlsoReportInput> | null
  if (!x || typeof x !== 'object') throw new Error('Invalid request')
  const scope = optScope(x.scope)
  const preferredLabel = optLabel(x.preferredLabel)
  return {
    mappingId: requireString(x.mappingId, 'tag'),
    concept: requireString(x.concept, 'element'),
    dims: requireDims(x.dims),
    ...(scope ? { scope } : {}),
    ...(typeof x.tableId === 'string' ? { tableId: x.tableId } : {}),
    ...(preferredLabel !== undefined ? { preferredLabel } : {}),
  }
}

const alsoItem = (v: unknown): { concept: string; preferredLabel?: string | null } => {
  const a = v as { concept?: unknown; preferredLabel?: unknown } | null
  const preferredLabel = optLabel(a?.preferredLabel)
  return { concept: requireString(a?.concept, 'element'), ...(preferredLabel !== undefined ? { preferredLabel } : {}) }
}

export function requireBlockInput(v: unknown): TableBlockInput {
  const x = v as Partial<TableBlockInput> | null
  if (!x || typeof x !== 'object') throw new Error('Invalid table mapping')
  const rows = list(x.rows, 'rows', (y): TableBlockRowInput => {
    const r = y as Partial<TableBlockRowInput>
    const scope = optScope(r?.scope)
    const preferredLabel = optLabel(r?.preferredLabel)
    return {
      r: index(r?.r, 'row'),
      concept: requireString(r?.concept, 'element'),
      ...(scope ? { scope } : {}),
      ...(preferredLabel !== undefined ? { preferredLabel } : {}),
      members: requireDims(r?.members),
      ...(r?.cols !== undefined ? { cols: list(r.cols, 'row columns', (c) => index(c, 'column')) } : {}),
      ...(r?.also !== undefined ? { also: list(r.also, 'also', alsoItem) } : {}),
    }
  })
  const cols = list(x.cols, 'columns', (y): TableBlockColumnInput => {
    const c = y as Partial<TableBlockColumnInput>
    const scope = optScope(c?.scope)
    return {
      c: index(c?.c, 'column'),
      ...(scope ? { scope } : {}),
      members: requireDims(c?.members),
      ...(c?.alsoTotal !== undefined ? { alsoTotal: list(c.alsoTotal, 'totals', (a) => requireString(a, 'axis')) } : {}),
    }
  })
  return {
    cell: requireCell(x.cell),
    tableId: requireString(x.tableId, 'table'),
    rows,
    cols,
    ...(x.sign === -1 || x.sign === 1 ? { sign: x.sign } : {}),
  }
}
