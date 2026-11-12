/**
 * Explicit user actions "Report empty mandatory amounts as 0": for one statement (ELR), and for the columns of a table
 * (ADR-0013: zeros come from the rules, not from Excel).
 *
 * MCA's specific rules make statement lines mandatory (SR-L16-1 Long-term borrowings, SR-L34-1 Intangible assets, …)
 * even when the company has none; filers report them as 0 (HPL's filed instance does). Only amounts are filled:
 * text and dates need the user. Only lines with no value, applicable for the year, outside dimensional tables.
 * Every value goes through Session.setValue (applicability, decimals, recalculation of totals).
 */
import type { DimensionRef } from './basics'
import { statementLinksFrom } from './core/derived.js'
import { dimensionallyValid, nondimAllowed } from './core/dimensions.js'
import type { Session } from './core/session.js'
import { filledTableColumns, singleMemberTables } from './core/table-columns.js'

export interface ZeroFill {
  concept: string
  scope: 'CY' | 'PY'
  ruleId: string
}

export type TableDim = DimensionRef

export interface TableZeroFill {
  tableId: string
  concept: string
  scope: 'CY' | 'PY'
  dims: TableDim[]
  ruleId: string
}

interface MandatoryRule {
  id: string
  status: string
  elr?: string
  scope?: { periods?: ('CY' | 'PY')[] }
  ast?: {
    type: string
    concept?: string
    when?: { op: string; value: string }
    tables?: string[]
    concepts?: string[]
    softConcepts?: string[]
  }
}

type Filing = { meta: { firstFinancialYear?: boolean; reportType?: string }; value(q: string, scope: string, dims: TableDim[]): unknown }

type AnySession = Session & {
  A: {
    rules: { rules: MandatoryRule[] }
    dataType(q: string): string
    isNumeric(q: string): boolean
  }
  app: {
    tableStatus(f: Filing, id: string, scope: string): { applicable: boolean }
    conceptStatus(f: Filing, q: string, scope: string): { applicable: boolean }
  }
  filing: Filing
  conceptStatus(q: string, scope: string): { applicable: boolean }
  getValue(q: string, scope: string): unknown
  setValue(q: string, scope: string, display: string, opts?: { recalc?: boolean }): unknown
  setTableValue(id: string, scope: string, dims: TableDim[], q: string, display: string, opts?: { recalc?: boolean }): unknown
}

/** Amounts, share counts and per-share amounts may be reported as 0 in a column the company has (ML-6 asks for the
 * amount called per share even when every share is fully called); rates and text need the user. */
const ZERO_TYPES = new Set(['monetary', 'shares', 'perShare'])
/** Filling can start a column through recalculation (net carrying amount = gross − accumulated): it runs again. */
const MAX_FILL_ROUNDS = 5

/** What the action would fill in the statement with this ELR code (no changes). */
export function mandatoryZeroPlan(session: Session, elrCode: string): ZeroFill[] {
  const S = session as AnySession
  const A = S.A
  const meta = S.filing.meta
  const years: ('CY' | 'PY')[] = meta.firstFinancialYear ? ['CY'] : ['CY', 'PY']
  const out: ZeroFill[] = []
  const seen = new Set<string>()
  for (const r of A.rules.rules) {
    if (r.status !== 'EXECUTABLE' || r.ast?.type !== 'mandatory' || r.elr !== elrCode || !r.ast.concept) continue
    if (r.ast.when && !(r.ast.when.op === 'reportType' && r.ast.when.value === meta.reportType)) continue
    const c = r.ast.concept
    if (A.dataType(c) !== 'monetary' || !nondimAllowed(A, c)) continue
    for (const scope of r.scope?.periods ?? years) {
      const key = `${c}|${scope}`
      if (!years.includes(scope) || seen.has(key) || S.getValue(c, scope) || !S.conceptStatus(c, scope).applicable) continue
      seen.add(key)
      out.push({ concept: c, scope, ruleId: r.id })
    }
  }
  return out
}

/** Applies the plan; returns what was filled. */
export function fillMandatoryZeros(session: Session, elrCode: string): ZeroFill[] {
  const plan = mandatoryZeroPlan(session, elrCode)
  const S = session as AnySession
  for (const z of plan) S.setValue(z.concept, z.scope, '0', { recalc: true })
  return plan
}

/**
 * What the table action would fill (no changes): for every table column (dimension combination) that already holds a
 * value for the year, the line items its "mandatory line items" rules require (ML-*) that are still empty, valid for
 * that column and applicable, and that are amounts or share counts. A column with no value is never started: zeros
 * come from the rules, not from guessing which columns the company has. Tables whose line items are needed under one
 * member only (lineItemSingleMember) and elements an MCA-accepted filing omits (softConcepts) are left out.
 * `tableId` limits the plan to one table.
 */
export function tableZeroPlan(session: Session, tableId?: string): TableZeroFill[] {
  const S = session as AnySession
  const A = S.A
  const f = S.filing
  const years: ('CY' | 'PY')[] = f.meta.firstFinancialYear ? ['CY'] : ['CY', 'PY']
  const out: TableZeroFill[] = []
  const seen = new Set<string>()
  for (const r of A.rules.rules) {
    if (r.status !== 'EXECUTABLE' || r.ast?.type !== 'lineItemsMandatory') continue
    const soft = new Set(r.ast.softConcepts ?? [])
    for (const id of r.ast.tables ?? []) {
      if ((tableId && id !== tableId) || singleMemberTables(A).has(id)) continue
      for (const scope of (r.scope?.periods ?? years).filter((y: 'CY' | 'PY') => years.includes(y))) {
        if (!S.app.tableStatus(f, id, scope).applicable) continue
        for (const dims of (filledTableColumns(A, f, id, scope) as Map<string, TableDim[]>).values()) {
          for (const q of r.ast.concepts ?? []) {
            const key = `${id}|${q}|${scope}|${JSON.stringify(dims)}`
            if (seen.has(key) || soft.has(q) || !A.isNumeric(q) || !ZERO_TYPES.has(A.dataType(q))) continue
            if (!dimensionallyValid(A, q, dims).valid || !S.app.conceptStatus(f, q, scope).applicable) continue
            if (f.value(q, scope, dims) != null) continue
            if (contradictsStatement(A, f, q, scope)) continue
            seen.add(key)
            out.push({ tableId: id, concept: q, scope, dims, ruleId: r.id })
          }
        }
      }
    }
  }
  return out
}

/**
 * A 0 for an element that a reported, non-zero statement figure is the sum of (statement ← note, e.g. share capital =
 * Σ paid-up value over the classes, SR-L541-1) would contradict that figure, and the statement figure — taken as
 * following an empty note — would be recalculated to 0. That line holds the statement's figure, never a rule zero.
 */
function contradictsStatement(A: AnySession['A'], f: AnySession['filing'], q: string, scope: 'CY' | 'PY'): boolean {
  return (statementLinksFrom(A, q) as { concept: string }[]).some((l) => {
    const v = f.value(l.concept, scope, [])
    return v != null && Number(v) !== 0
  })
}

/**
 * Applies the table plan through Session.setTableValue (validity, applicability, recalculation); returns what was filled.
 * A fill can derive a value into another column (net carrying amount from gross and accumulated depreciation), which
 * then has a value and its own mandatory line items: the plan is applied again until nothing is left (bounded).
 */
export function fillTableMandatoryZeros(session: Session, tableId?: string): TableZeroFill[] {
  const S = session as AnySession
  const filled: TableZeroFill[] = []
  for (let round = 0; round < MAX_FILL_ROUNDS; round++) {
    const plan = tableZeroPlan(session, tableId)
    if (!plan.length) break
    for (const z of plan) S.setTableValue(z.tableId, z.scope, z.dims, z.concept, '0', { recalc: true })
    filled.push(...plan)
  }
  return filled
}
