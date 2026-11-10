/**
 * Explicit user action "Report empty mandatory amounts as 0" for one statement (ELR).
 *
 * MCA's specific rules make statement lines mandatory (SR-L16-1 Long-term borrowings, SR-L34-1 Intangible assets, …)
 * even when the company has none; filers report them as 0 (HPL's filed instance does). Only amounts are filled:
 * text and dates need the user. Only lines with no value, applicable for the year, outside dimensional tables.
 * Every value goes through Session.setValue (applicability, decimals, recalculation of totals).
 */
import { nondimAllowed } from './core/dimensions.js'
import type { Session } from './core/session.js'

export interface ZeroFill {
  concept: string
  scope: 'CY' | 'PY'
  ruleId: string
}

interface MandatoryRule {
  id: string
  status: string
  elr?: string
  scope?: { periods?: ('CY' | 'PY')[] }
  ast?: { type: string; concept?: string; when?: { op: string; value: string } }
}

type AnySession = Session & {
  A: {
    rules: { rules: MandatoryRule[] }
    dataType(q: string): string
  }
  filing: { meta: { firstFinancialYear?: boolean; reportType?: string } }
  conceptStatus(q: string, scope: string): { applicable: boolean }
  getValue(q: string, scope: string): unknown
  setValue(q: string, scope: string, display: string, opts?: { recalc?: boolean }): unknown
}

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
