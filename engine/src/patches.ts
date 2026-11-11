/**
 * AI fix patches (ADR-0012, docs/07): the engine's side. Deterministic and pure (no AI, no I/O).
 *
 * - `checkPatch` decides whether a proposed patch can be shown at all: the element exists and is reportable here,
 *   the value fits its type, the year is applicable and not locked, an amount's arithmetic identity really holds.
 *   It also gives the before → after the review card shows, and whether the user must type or confirm something.
 * - `applyFactPatch` applies the fact-level ops through the Session (the same path as typing: applicability,
 *   decimals, recalculation of totals). Cell-level ops (remap, setScope, a setValue read from a cell) are applied by
 *   the app's MappingService, which keeps the Excel linkage; the engine only checks them.
 * - `dryRun` applies fact-level ops to a copy of the filing and validates it, so a card can say whether the patch
 *   clears its problem. The filing itself is never touched.
 * Amounts are decimal strings (engine decimal type); never JS floats.
 */
import * as Dec from './core/decimal.js'
import { nondimAllowed } from './core/dimensions.js'
import { Filing } from './core/model.js'
import { toCanonical } from './core/scaling.js'
import { Session } from './core/session.js'

export type PatchScope = 'CY' | 'PY'

export interface PatchFactTarget {
  /** an existing fact; absent for a new non-dimensional fact */
  key?: string
  concept: string
  scope: PatchScope
}

export interface PatchCell {
  workbook: string
  sheet: string
  ref: string
}

export type PatchSource =
  | { kind: 'cell'; cell: PatchCell }
  | { kind: 'identity'; terms: { factKey: string; weight: 1 | -1 }[] }
  | { kind: 'user' }

interface Common {
  rationale?: string
  confidence?: number
}

export type FixPatch =
  | (Common & { op: 'setValue'; fact: PatchFactTarget; value?: string | null; source: PatchSource })
  | (Common & { op: 'setNil'; fact: PatchFactTarget })
  | (Common & { op: 'remap'; cell: PatchCell; from?: string | null; to: string })
  | (Common & { op: 'setScope'; cell: PatchCell; to: PatchScope })
  | (Common & { op: 'removeFact'; fact: PatchFactTarget })
  | (Common & { op: 'setText'; fact: PatchFactTarget; value?: string | null; source: PatchSource })

/** Fact-level ops: what applyFactPatch and dryRun accept. */
export type FactPatch = Extract<FixPatch, { op: 'setValue' | 'setNil' | 'removeFact' | 'setText' }>

export interface PatchCheck {
  ok: boolean
  /** why the patch cannot be shown / applied */
  problems: string[]
  /** what the card shows: the current value (or element, for remap) → the new one */
  before: string | null
  after: string | null
  /** the user must type the value (source "user" without a value) */
  needsInput: boolean
  /** the user must confirm explicitly (removeFact, any source "user") */
  needsConfirm: boolean
  /** the fact the patch is about, when there is one (for links in the card) */
  factKey: string | null
}

export interface PatchOptions {
  /** the value the user typed or confirmed in the card (source "user") */
  input?: string | null
}

type Fact = {
  key: string
  concept: string
  period: { type: string; date?: string; start?: string; end?: string }
  dims: unknown[]
  value: string | null
  nil: boolean
  decimals: string | null
}

type Engine = Session & {
  A: {
    concept(q: string): { nillable?: boolean } | null
    isReportable(q: string): boolean
    isNumeric(q: string): boolean
    dataType(q: string): string
    label(q: string): string
  }
  filing: Filing & {
    facts: Map<string, Fact>
    meta: { level: string; periods: { py?: { end?: string } | null }; firstFinancialYear?: boolean }
    scopeOf(p: Fact['period']): string
    canonicalValue(q: string, raw: unknown): string
    setFact(f: Record<string, unknown>): Fact
    removeFact(key: string): boolean
    toJSON(): unknown
  }
  conceptStatus(q: string, scope: string): { applicable: boolean; reasons?: string[] }
  pyLocked(scope: string): boolean
  periodForCell(q: string, scope: string): Fact['period'] | null
  getValue(q: string, scope: string, dims?: unknown[]): Fact | null
  setValue(q: string, scope: string, display: string, opts?: Record<string, unknown>): Fact | null
  displayOf(f: Fact | null): string
  removeFacts(list: Fact[]): number
  recalcFrom(q: string, period: Fact['period'], dims: unknown[], depth: number, change: unknown): void
  validate(opts?: Record<string, unknown>): { issues: unknown[] }
}

const NUMBER = /^-?\d+(\.\d+)?$/
const TEXT_TYPES = new Set(['string', 'token', 'textBlock', 'date', 'boolean', 'enum'])
const plain = (v: string) => v.trim().replace(/,/g, '')

export function isFactPatch(p: FixPatch): p is FactPatch {
  return p.op === 'setValue' || p.op === 'setNil' || p.op === 'removeFact' || p.op === 'setText'
}

/** Checks a patch against the filing. Never changes anything. */
export function checkPatch(session: Session, patch: FixPatch, opts: PatchOptions = {}): PatchCheck {
  const S = session as Engine
  const out: PatchCheck = { ok: true, problems: [], before: null, after: null, needsInput: false, needsConfirm: false, factKey: null }
  const fail = (msg: string) => {
    out.ok = false
    out.problems.push(msg)
    return out
  }
  const A = S.A
  switch (patch.op) {
    case 'remap': {
      if (!reportable(S, patch.to)) return fail(`${patch.to} is not a reportable element of this taxonomy.`)
      if (!nondimAllowed(A as never, patch.to)) return fail(`${A.label(patch.to)} is reported inside a table; re-tagging to table cells comes later.`)
      if (patch.from && A.isReportable(patch.from) && A.isNumeric(patch.from) !== A.isNumeric(patch.to)) {
        return fail(`${A.label(patch.from)} and ${A.label(patch.to)} hold different kinds of values (amount vs text).`)
      }
      if (patch.from && patch.from === patch.to) return fail('The cell is already tagged with that element.')
      out.before = patch.from ? A.label(patch.from) : null
      out.after = A.label(patch.to)
      return out
    }
    case 'setScope': {
      if (patch.to === 'PY' && (S.filing.meta.firstFinancialYear || !S.filing.meta.periods.py?.end)) {
        return fail('This is the first financial year: there is no previous year.')
      }
      out.after = patch.to
      return out
    }
    default:
      return checkFactPatch(S, patch, opts, out, fail)
  }
}

function checkFactPatch(S: Engine, patch: FactPatch, opts: PatchOptions, out: PatchCheck, fail: (m: string) => PatchCheck): PatchCheck {
  const A = S.A
  const { concept, scope } = patch.fact
  if (!reportable(S, concept)) return fail(`${concept} is not a reportable element of this taxonomy.`)
  if (scope === 'PY' && (S.filing.meta.firstFinancialYear || !S.filing.meta.periods.py?.end)) return fail('This is the first financial year: there is no previous year.')
  // removeFact names the exact fact; a set op is about the element and year (a key that does not match them is ignored)
  const byKey = patch.fact.key ? S.filing.facts.get(patch.fact.key) ?? null : null
  const keyFits = !!byKey && byKey.concept === concept && S.filing.scopeOf(byKey.period) === scope
  const existing = patch.op === 'removeFact' ? byKey : keyFits ? byKey : S.getValue(concept, scope, [])
  if (patch.op === 'removeFact') {
    if (!patch.fact.key || !byKey) return fail('That fact is no longer in the filing.')
    if (byKey.concept !== concept) return fail('The fact key and the element do not match.')
    if (S.filing.scopeOf(byKey.period) !== scope) return fail(`That fact is not a ${scope === 'CY' ? 'current' : 'previous'}-year value.`)
  }
  out.factKey = existing?.key ?? null
  out.before = existing ? (existing.nil ? '(nil)' : S.displayOf(existing)) : null
  if (S.pyLocked(scope)) return fail("The previous year is locked (last year's filed figures); unlock it first.")

  if (patch.op === 'removeFact') {
    if (!existing) return fail('There is no such fact to remove.')
    out.after = null
    out.needsConfirm = true
    return out
  }
  if (existing && existing.dims.length) return fail('Values inside tables cannot be changed by an AI patch yet; edit the table.')
  if (!nondimAllowed(A as never, concept)) return fail(`${A.label(concept)} is reported inside a table; that comes later.`)
  const status = S.conceptStatus(concept, scope)
  if (!status.applicable) return fail(`${A.label(concept)} is not applicable for the ${scope === 'CY' ? 'current' : 'previous'} year${status.reasons?.length ? ` (${status.reasons[0]})` : ''}.`)

  if (patch.op === 'setNil') {
    if (A.concept(concept)?.nillable === false) return fail(`${A.label(concept)} cannot be reported as nil.`)
    out.after = '(nil)'
    return out
  }

  const fromUser = patch.source.kind === 'user'
  const value = fromUser && opts.input != null && opts.input !== '' ? opts.input : patch.value ?? null
  out.needsConfirm = fromUser
  if (value == null || value === '') {
    if (!fromUser) return fail('The patch has no value.')
    out.needsInput = true
    return out
  }

  if (patch.op === 'setValue') {
    if (!A.isNumeric(concept)) return fail(`${A.label(concept)} is not an amount; use a text patch.`)
    if (!NUMBER.test(plain(value))) return fail(`“${value}” is not a number.`)
    if (patch.source.kind === 'identity') {
      const why = identityProblem(S, concept, plain(value), patch.source.terms)
      if (why) return fail(why)
    }
    out.after = plain(value)
    return out
  }

  // setText
  if (A.isNumeric(concept) || !TEXT_TYPES.has(A.dataType(concept))) return fail(`${A.label(concept)} is an amount; use a value patch.`)
  if (patch.source.kind === 'identity') return fail('A text value cannot come from an arithmetic identity.')
  try {
    out.after = S.filing.canonicalValue(concept, value)
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
  }
  return out
}

/** Σ weight × term = value, in rupees, at the coarsest accuracy among the terms (their decimals). */
function identityProblem(S: Engine, concept: string, display: string, terms: { factKey: string; weight: 1 | -1 }[]): string | null {
  const facts = terms.map((t) => ({ t, f: S.filing.facts.get(t.factKey) }))
  const missing = facts.find((x) => !x.f)
  if (missing) return 'An identity term is no longer in the filing.'
  if (facts.some((x) => !S.A.isNumeric(x.f!.concept))) return 'An identity term is not an amount.'
  const total = Dec.sum(facts.map(({ t, f }) => (f!.nil || f!.value == null ? Dec.parse('0') : Dec.mul(Dec.parse(f!.value), String(t.weight)))))
  const target = S.A.dataType(concept) === 'monetary' ? toCanonical(display, S.filing.meta.level) : display
  const places = facts.map((x) => x.f!.decimals).filter((d): d is string => d != null && d !== 'INF').map(Number)
  const d = places.length ? Math.min(...places) : 0
  if (Dec.eq(Dec.round(total, d), Dec.round(Dec.parse(target), d))) return null
  return `The identity gives ${Dec.toString(total)}, not ${target} (in rupees): the amount is not backed by the facts it names.`
}

function reportable(S: Engine, q: string): boolean {
  return !!S.A.concept(q) && S.A.isReportable(q)
}

/**
 * Applies a fact-level patch through the Session. Throws when the patch no longer checks out (the filing changed
 * since it was proposed). `display` overrides the value (a setValue read from a cell, applied by the app).
 */
export function applyFactPatch(session: Session, patch: FactPatch, opts: PatchOptions = {}): void {
  const S = session as Engine
  const check = checkPatch(session, patch, opts)
  if (!check.ok) throw new PatchError(check.problems)
  if (check.needsInput) throw new PatchError(['Type the value first.'])
  const { concept, scope } = patch.fact
  switch (patch.op) {
    case 'removeFact': {
      const f = S.filing.facts.get(check.factKey!)
      if (f) S.removeFacts([f])
      return
    }
    case 'setNil': {
      const period = S.periodForCell(concept, scope)
      if (!period) throw new PatchError(['Reporting periods are not set.'])
      const before = S.getValue(concept, scope, [])
      S.filing.setFact({ concept, period, nil: true, origin: 'ai' })
      if (S.A.isNumeric(concept) && before && !before.nil) S.recalcFrom(concept, period, [], 0, { before: before.value, after: null })
      return
    }
    case 'setValue':
    case 'setText':
      S.setValue(concept, scope, check.after!, { recalc: S.A.isNumeric(concept), strict: true })
      return
  }
}

export interface DryRunResult {
  /** gate issues of the filing copy after the patches */
  issues: unknown[]
  /** patches that could not be applied to the copy, with the reason */
  failed: { index: number; problems: string[] }[]
}

/** Applies fact-level patches to a copy of the filing and validates the copy. The filing itself is untouched. */
export function dryRun(session: Session, patches: { patch: FactPatch; input?: string | null }[], validateOpts: Record<string, unknown> = {}): DryRunResult {
  const S = session as Engine
  const copy = new Session(S.A as never, Filing.fromJSON(S.A as never, JSON.parse(JSON.stringify(S.filing.toJSON()))) as never) as Engine
  const failed: DryRunResult['failed'] = []
  patches.forEach(({ patch, input }, index) => {
    try {
      applyFactPatch(copy, patch, { input })
    } catch (err) {
      failed.push({ index, problems: err instanceof PatchError ? err.problems : [err instanceof Error ? err.message : String(err)] })
    }
  })
  return { issues: copy.validate(validateOpts).issues, failed }
}

export class PatchError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(' '))
    this.name = 'PatchError'
  }
}
