/**
 * Table blocks (ADR-0013): an Excel range mapped to one taxonomy table. Pure and deterministic: the authority and a
 * block spec in, one planned fact per non-empty cell out, each with the problems that would stop it being filed.
 * The app's preview, its apply step (MappingService → Session.setTableValue) and the evaluation share this function.
 *
 * Each non-empty cell (r, c) of the block is one fact:
 * - element from its row. Of the row's label roles only the period ones choose the fact (an opening balance is the
 *   table's periodStartLabel row, a closing one its periodEndLabel row); a negated or total label only changes how
 *   the table displays the value, so the planned fact takes the table row's own role;
 * - dimensions = the row's members ∪ the column's members (explicit or typed; an axis given twice must agree);
 * - period = the row's scope, else the column's, else the column's period in the sheet (`columnScope`).
 * A row may be limited to some columns (`cols`: a party reports under its own category only). The same figure can be
 * reported again ("also", one cell → more facts, ADR-0013):
 * - `row.also`: other line items of the table the cells also are (a fair value equal to the carrying amount);
 * - `col.alsoTotal`: axes whose total (the default) the column's figure also is, because its member is the only one
 *   with figures (financial assets at amortised cost, the one category the company has).
 * Applicability for the year (is the table open?) depends on the filing: Session.setTableValue checks it on apply.
 */
import type { DimensionRef } from './basics'
import type { Authority } from './core/authority.js'
import { checkDimensionSyntax, dimensionallyValid, tablesForFact } from './core/dimensions.js'
import { dimKey, normDims } from './core/model.js'
import { buildTableView } from './core/views.js'

export type TableScope = 'CY' | 'PY'

export interface TableBlockRow {
  /** 0-based sheet row */
  r: number
  concept: string
  preferredLabel?: string | null
  scope?: TableScope
  members?: DimensionRef[]
  /** the only columns (0-based) this row reports; every column when absent */
  cols?: number[]
  /** other line items the row's cells also report, with the same members and year */
  also?: TableBlockAlsoItem[]
}

export interface TableBlockAlsoItem {
  concept: string
  preferredLabel?: string | null
}

export interface TableBlockColumn {
  /** 0-based sheet column */
  c: number
  members?: DimensionRef[]
  scope?: TableScope
  /** axes whose total (the axis default) the column's figures also are */
  alsoTotal?: string[]
}

export interface TableBlockSpec {
  tableId: string
  rows: TableBlockRow[]
  cols: TableBlockColumn[]
}

export interface PlannedTableFact {
  r: number
  c: number
  tableId: string
  concept: string
  preferredLabel: string | null
  scope: TableScope | null
  dims: DimensionRef[]
  /** why this cell can't be filed as planned; empty = ready */
  problems: string[]
  /** the same figure reported again (row.also, col.alsoTotal); planned only when the main fact is ready */
  also: PlannedAlsoFact[]
}

export interface PlannedAlsoFact {
  concept: string
  preferredLabel: string | null
  dims: DimensionRef[]
  problems: string[]
}

export interface PlanOptions {
  /** does the sheet cell hold a value? Blank cells give no fact (a 0 gives 0). */
  hasValue(r: number, c: number): boolean
  /** the period of a sheet column (header dates or the user's choice), or null when unknown */
  columnScope(c: number): TableScope | null
}

type View = ReturnType<typeof buildTableView>

export class UnknownTableError extends Error {}

export const NO_MEMBER = 'This cell has no member, so it is a statement figure, not a table value: tag the cell itself, or give its row or column a member.'

export function planTableBlock(A: Authority, spec: TableBlockSpec, opts: PlanOptions): PlannedTableFact[] {
  const t = A.table(spec.tableId)
  if (!t) throw new UnknownTableError(`Unknown table ${spec.tableId}`)
  const view = buildTableView(A, spec.tableId) as View
  const tableAxes = new Set<string>(t.axes.map((a: { axis: string }) => a.axis))
  const out: PlannedTableFact[] = []
  const seen = new Map<string, string>()
  const ctx: FactContext = { A, view, tableAxes, seen }
  for (const row of spec.rows) {
    for (const col of spec.cols) {
      if (row.cols && !row.cols.includes(col.c)) continue
      if (!opts.hasValue(row.r, col.c)) continue
      const { dims, conflicts } = mergeMembers(row.members ?? [], col.members ?? [])
      const scope = row.scope ?? col.scope ?? opts.columnScope(col.c)
      const at = `${row.r}:${col.c}`
      const main = planFact(ctx, row, dims, scope, at, conflicts)
      if (!scope) main.problems.push('The period of this column is unknown: set it to CY or PY.')
      const also: PlannedAlsoFact[] = []
      if (!main.problems.length) {
        const totals = col.alsoTotal ?? []
        const reduced = dims.filter((d) => !totals.includes(d.axis))
        const variants: [TableBlockRow | TableBlockAlsoItem, DimensionRef[]][] = [
          ...(reduced.length < dims.length ? [[row, reduced] as [TableBlockRow, DimensionRef[]]] : []),
          ...(row.also ?? []).flatMap((item) => [[item, dims], ...(reduced.length < dims.length ? [[item, reduced]] : [])] as [TableBlockAlsoItem, DimensionRef[]][]),
        ]
        for (const [item, d] of variants) {
          const f = planFact(ctx, item, d, scope, at, [])
          also.push({ concept: item.concept, preferredLabel: f.preferredLabel, dims: f.dims, problems: f.problems })
        }
      }
      out.push({ r: row.r, c: col.c, tableId: spec.tableId, concept: row.concept, preferredLabel: main.preferredLabel, scope, dims: main.dims, problems: main.problems, also })
    }
  }
  return out
}

interface FactContext {
  A: Authority
  view: View
  tableAxes: Set<string>
  /** fact key → the cell that files it (one fact ← one cell, within the block) */
  seen: Map<string, string>
}

/** One fact of a cell (the main one or an "also" one): its table row, members and the problems that stop it. */
function planFact(ctx: FactContext, item: { concept: string; preferredLabel?: string | null }, dims: DimensionRef[], scope: TableScope | null, at: string, conflicts: string[]) {
  const { A, view, tableAxes, seen } = ctx
  const { label: preferredLabel, problems: rowProblems } = tableRow(A, view, item)
  const problems = [...rowProblems, ...conflicts]
  // a table value has a member on some axis; with none it is the statement figure (e.g. a Total column's net row)
  if (!dims.length) problems.push(NO_MEMBER)
  for (const d of dims) if (!tableAxes.has(d.axis)) problems.push(`${A.label(d.axis)} is not an axis of this table.`)
  problems.push(...checkDimensionSyntax(A, dims).map((e: { msg: string }) => e.msg))
  const nd = normDims(dims) as DimensionRef[]
  if (!problems.length) {
    const dv = dimensionallyValid(A, item.concept, nd)
    if (!dv.valid) problems.push(`${A.label(item.concept)} can't be reported for these members: ${dv.reason}`)
  }
  if (scope && !problems.length) {
    const key = `${item.concept}|${preferredLabel ?? ''}|${scope}|${dimKey(nd)}`
    const first = seen.get(key)
    if (first) problems.push(`Another cell of this block (${first}) is already this fact.`)
    else seen.set(key, at)
  }
  return { preferredLabel, dims: nd, problems }
}

/** The table a dimensional fact belongs to (the one whose axes match its members exactly, when one does). */
export function tableOfFact(A: Authority, concept: string, dims: DimensionRef[]): string | null {
  if (!dims.length) return null
  const tables = tablesForFact(A, { concept, dims }) as { id: string }[]
  return tables[0]?.id ?? null
}

const PERIOD_ROLES = new Set(['periodStartLabel', 'periodEndLabel'])

/** The table row a block row is: same element and, for opening / closing balances, the same period role. */
function tableRow(A: Authority, view: View, row: { concept: string; preferredLabel?: string | null }): { label: string | null; problems: string[] } {
  const rows = view.lineItems.filter((l) => !l.abstract && l.concept === row.concept)
  if (!rows.length) return { label: null, problems: [`${A.label(row.concept) || row.concept} is not a line item of ${view.title}.`] }
  const wanted = row.preferredLabel && PERIOD_ROLES.has(row.preferredLabel) ? row.preferredLabel : null
  const match = wanted ? rows.find((l) => l.preferredLabel === wanted) : rows.find((l) => l.preferredLabel !== 'periodStartLabel') ?? rows[0]
  if (!match) {
    const which = wanted === 'periodStartLabel' ? 'opening balance' : 'closing balance'
    return { label: null, problems: [`${view.title} has no ${which} row for ${A.label(row.concept)}.`] }
  }
  return { label: match.preferredLabel ?? null, problems: [] }
}

function mergeMembers(rowMembers: DimensionRef[], colMembers: DimensionRef[]): { dims: DimensionRef[]; conflicts: string[] } {
  const byAxis = new Map<string, DimensionRef>()
  const conflicts: string[] = []
  for (const d of [...rowMembers, ...colMembers]) {
    const prev = byAxis.get(d.axis)
    if (prev && (prev.member ?? prev.typed) !== (d.member ?? d.typed)) conflicts.push(`The row and the column give ${d.axis} different members.`)
    else byAxis.set(d.axis, d)
  }
  return { dims: [...byAxis.values()], conflicts }
}
