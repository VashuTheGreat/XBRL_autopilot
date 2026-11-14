/**
 * Statement ↔ note matching (docs/14 Step 1, webXBRL's "difference" on each statement line).
 *
 * A main-statement figure is supplied by a note (core/derived.js statementNoteLinks):
 *   'sum'    the statement figure = Σ of a note element over an axis (an MCA rule): note figure = Session.noteValue;
 *   'row'    the same element is a calculation total of the note: note figure = Σ of its parts in the note's own
 *            calculation network (Session.networkSum);
 *   'column' the same element is the total column of a note table: note figure = Σ of its first-level members on a
 *            table axis whose members add up (the same reading as Session.noteValue).
 * noteTies compares, per year, the statement figure with what its note adds up to. statementDifference lists the
 * calculation inconsistencies of the statement's own networks (runCalculations, the ELR's calculation roots), so the
 * Form can tell whether the whole statement adds up — nothing is hard-coded (no "Assets = Equity + Liabilities").
 *
 * Amounts are canonical decimal strings (engine decimal), never floats. Taxonomy-generic: links, networks and axes come
 * from the authority; ELRs are matched by their own code, never a fixed one.
 */
import { calculationNetworks, ctxOf, runCalculations } from './core/calculation.js'
import * as Dec from './core/decimal.js'
import { derivations, statementNoteLinks } from './core/derived.js'
import { reportingYear } from './core/periods.js'
import { RuleEngine } from './core/rules.js'
import { agrees, type Session } from './core/session.js'

export type TieScope = 'CY' | 'PY'
/**
 * - ok:           the note adds up to the statement figure (or the statement reports 0 and the note is empty)
 * - mismatch:     both have a figure and they differ
 * - note-empty:   the statement has a figure, the note has none yet
 * - no-statement: nothing to compare — the year is closed, the statement / line / note is not applicable, or the
 *                 statement figure is empty
 * - undetermined: the note's values cannot be added up (an unusual layout); nothing is claimed
 */
export type TieStatus = 'ok' | 'mismatch' | 'note-empty' | 'no-statement' | 'undetermined'

export interface TiePeriod {
  statement: string | null
  note: string | null
  /** statement − note, when both have a figure */
  difference: string | null
  status: TieStatus
}

export interface NoteTie {
  concept: string
  kind: 'row' | 'column' | 'sum'
  /** where the note figure lives: the note (ELR), its table, and the element added up there */
  target: { elrUri: string; tableId?: string; concept: string }
  cy: TiePeriod
  py: TiePeriod
}

export interface CalcIssue {
  /** calculation ELR and the total whose parts don't add up */
  elr: string
  parent: string
  factKey: string
  dims: { axis: string; member?: string; typed?: string }[]
  reported: string
  computed: string
  /** reported − computed */
  difference: string
}

export interface PeriodDifference {
  /** Σ |reported − computed| over the issues: 0 when every total of the statement adds up */
  difference: string
  issues: CalcIssue[]
}

export interface StatementDifference {
  /** null: the year is closed or the statement is not applicable for it */
  cy: PeriodDifference | null
  py: PeriodDifference | null
}

// ---- the parts of the (JS) engine this module reads -------------------------------------------------------------

type Decimal = { n: bigint; s: number }
type Dim = { axis: string; member?: string; typed?: string }
type Period = { type: 'instant' | 'duration'; date?: string; start?: string; end?: string }
type Fact = { key: string; concept: string; value: string; decimals?: string | null; nil?: boolean; dims: Dim[]; period: Period }
type Link = {
  concept: string
  kind: 'row' | 'column' | 'sum'
  target: string
  elrUri: string
  tableId?: string
  spec?: { concept: string; axis: string; level: string; fixed?: Record<string, string> }
}
type NoteSum = { total: Decimal; decimals: string | number } | { undetermined: true } | null
type Authority = {
  elr(uri: string): { uri: string; code: string; group: string } | null
  json: { roles: Record<string, { code?: string } | undefined> }
  table(id: string): { id: string; axes: { axis: string; typed?: boolean }[] } | null
  dimensionDefault(axis: string): string | null
}
type Calc = {
  elr: string
  parent: string
  period: Period
  dims: Dim[]
  factKey: string
  status: string
  reported?: string
  computed?: string
  children?: { concept: string }[]
  missingChildren?: string[]
}
type View = {
  A: Authority
  filing: {
    meta: { firstFinancialYear?: boolean; periods: unknown }
    period(concept: string, scope: TieScope): Period | null
    all(): Fact[]
    factsOf(concept: string): Fact[]
  }
  elrStatus(uri: string, scope: TieScope): { applicable: boolean }
  conceptStatus(q: string, scope: TieScope): { applicable: boolean }
  getValue(q: string, scope: TieScope): Fact | null
  noteLink(concept: string, scope: TieScope, tabElrUri: string): Link | null
  noteValue(link: Pick<Link, 'spec'>, scope: TieScope): NoteSum
  networkSum(elr: string, parent: string, period: Period, dims: Dim[]): { count: number; total: Decimal; decimals: string | number }
}

const SCOPES: TieScope[] = ['CY', 'PY']
const code6 = (code: string | undefined) => code?.slice(0, 6)
const NONE: TiePeriod = { statement: null, note: null, difference: null, status: 'no-statement' }

/** The year has no reporting period (first financial year: no previous year), or the statement is closed for it. */
function yearOpen(S: View, elrUri: string, scope: TieScope): boolean {
  if (scope === 'PY' && S.filing.meta.firstFinancialYear) return false
  return S.elrStatus(elrUri, scope).applicable
}

/** What the note adds up to for one link and year: a total, null (the note holds nothing), or undetermined. */
function noteFigure(S: View, link: Link, scope: TieScope): NoteSum {
  if (link.kind === 'sum') return S.noteValue(link, scope)
  const period = S.filing.period(link.target, scope)
  if (!period) return null
  if (link.kind === 'row') {
    // the element's calculation network(s) in its note (same ELR code); the first that has parts reported
    const code = code6(S.A.elr(link.elrUri)?.code)
    const elrs = new Set(calculationNetworks(S.A).filter((n: { elr: string; parent: string }) => n.parent === link.target && code6(S.A.json.roles[n.elr]?.code) === code).map((n: { elr: string }) => n.elr))
    for (const elr of elrs) {
      const s = S.networkSum(elr, link.target, period, [])
      if (s.count) return { total: s.total, decimals: s.decimals }
    }
    return null
  }
  // 'column': Σ of the first-level members on an axis of the note table whose members add up (not gross /
  // accumulated → carrying, MCA member-difference axes); the first axis with values
  const t = link.tableId ? S.A.table(link.tableId) : null
  const arith = new Set((derivations(S.A) as { arith: Map<string, unknown> }).arith.keys())
  let undetermined = false
  for (const ax of t?.axes ?? []) {
    if (ax.typed || arith.has(ax.axis) || !S.A.dimensionDefault(ax.axis)) continue
    const v = S.noteValue({ spec: { concept: link.target, axis: ax.axis, level: 'firstLevel' } }, scope)
    if (v && 'undetermined' in v) undetermined = true
    else if (v) return v
  }
  return undetermined ? { undetermined: true } : null
}

function tiePeriod(S: View, elrUri: string, link: Link, scope: TieScope): TiePeriod {
  if (!yearOpen(S, elrUri, scope) || !S.conceptStatus(link.concept, scope).applicable || !S.noteLink(link.concept, scope, elrUri)) return NONE
  const x = S.getValue(link.concept, scope)
  const v = noteFigure(S, link, scope)
  const note = v && !('undetermined' in v) ? Dec.toString(v.total) : null
  if (!x || x.nil || x.value == null) return { ...NONE, note }
  const statement = Dec.toString(Dec.parse(x.value))
  if (v && 'undetermined' in v) return { statement, note: null, difference: null, status: 'undetermined' }
  // a nil balance (0) on the statement needs nothing in its note (Session.nilAllowed)
  if (!v) return { statement, note: null, difference: null, status: Dec.isZero(Dec.parse(x.value)) ? 'ok' : 'note-empty' }
  // equal after rounding both to the statement figure's decimals (XBRL Calculations 1.1), as the Session decides
  const ok = agrees(x, v)
  return { statement, note, difference: ok ? '0' : Dec.toString(Dec.sub(Dec.parse(x.value), v.total)), status: ok ? 'ok' : 'mismatch' }
}

/**
 * The statement lines of this ELR that a note supplies, with the statement figure, the note figure and their
 * difference per year. Empty for an ELR that is not a main statement (notes and disclosures have no such lines).
 */
export function noteTies(session: Session, elrUri: string): NoteTie[] {
  const S = session as unknown as View
  const A = S.A
  if (A.elr(elrUri)?.group !== 'Statements') return []
  const onStatement = new Set((session as unknown as { elrView(uri: string): { rows: { kind: string; concept?: string }[] } }).elrView(elrUri).rows.filter((r) => r.kind === 'item').map((r) => r.concept))
  const out: NoteTie[] = []
  for (const link of (statementNoteLinks(A) as Map<string, Link>).values()) {
    if (!onStatement.has(link.concept)) continue
    out.push({
      concept: link.concept,
      kind: link.kind,
      target: { elrUri: link.elrUri, ...(link.tableId ? { tableId: link.tableId } : {}), concept: link.target },
      cy: tiePeriod(S, elrUri, link, 'CY'),
      py: tiePeriod(S, elrUri, link, 'PY'),
    })
  }
  return out
}

const EXEMPT = new WeakMap<object, Set<string>>()
/** MCA "Parent child exempt calculation": a total with an exempt part may differ from its parts (a warning only). */
function exemptions(A: Authority): Set<string> {
  let ex = EXEMPT.get(A)
  if (!ex) EXEMPT.set(A, (ex = new RuleEngine(A).calcExemptions() as Set<string>))
  return ex
}

/**
 * The calculation inconsistencies of this ELR's own calculation networks (the calculation ELRs with its code), per
 * year, and one total figure: Σ |reported − computed|, so "0" means every total of the statement adds up. Totals with
 * an MCA-exempt part are left out, as the rule engine only warns about them. null for a closed / not-applicable year.
 */
export function statementDifference(session: Session, elrUri: string): StatementDifference {
  const S = session as unknown as View
  const A = S.A
  const code = code6(A.elr(elrUri)?.code)
  const out: StatementDifference = { cy: null, py: null }
  if (!code) return out
  const open = Object.fromEntries(SCOPES.map((s) => [s, yearOpen(S, elrUri, s)])) as Record<TieScope, boolean>
  for (const s of SCOPES) if (open[s]) out[s.toLowerCase() as 'cy' | 'py'] = { difference: '0', issues: [] }
  if (!open.CY && !open.PY) return out
  const ex = exemptions(A)
  const calc = runCalculations(A, S.filing) as Calc[]
  const seen = new Set<string>()
  const totals: Record<TieScope, Decimal> = { CY: Dec.ZERO, PY: Dec.ZERO }
  for (const c of calc) {
    if (c.status !== 'FAIL' || code6(A.json.roles[c.elr]?.code) !== code) continue
    if (c.children?.some((k) => ex.has(k.concept)) || c.missingChildren?.some((q) => ex.has(q))) continue
    const scope = reportingYear(S.filing.meta.periods, c.period) as string
    if (scope !== 'CY' && scope !== 'PY') continue
    const slot = out[scope.toLowerCase() as 'cy' | 'py']
    if (!slot) continue
    // one figure per total and context, even when the ELR has the network twice
    const key = `${c.elr}|${c.parent}|${ctxOf(c)}`
    if (seen.has(key)) continue
    seen.add(key)
    const diff = Dec.sub(Dec.parse(c.reported!), Dec.parse(c.computed!))
    slot.issues.push({ elr: c.elr, parent: c.parent, factKey: c.factKey, dims: c.dims, reported: c.reported!, computed: c.computed!, difference: Dec.toString(diff) })
    totals[scope] = Dec.add(totals[scope], Dec.sign(diff) < 0 ? Dec.neg(diff) : diff)
  }
  for (const s of SCOPES) {
    const slot = out[s.toLowerCase() as 'cy' | 'py']
    if (slot) slot.difference = Dec.toString(totals[s])
  }
  return out
}
