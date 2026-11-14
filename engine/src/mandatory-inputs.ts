/**
 * Mandatory non-numeric items and key answers (docs/14 Step 5). No rule logic of its own:
 *   mandatoryInputs  the text / date / Yes-No / list items still empty that the MCA rules require now, per year
 *                    (form-marks mandatoryGap = core/mandatory-marks.js mandatoryCell + applicability). Amounts stay
 *                    with "Empty mandatory → 0" (mandatory-zeros.ts).
 *   requiredTables   tables an answer makes mandatory ("This table is mandatory if X is Yes") that are still empty:
 *                    the rule engine's own tableRequired evaluation, run for those rules only.
 *   keyAnswers       the Yes/No answers Generate asks the filer to confirm: the knowledge base's curated keyAnswers
 *                    (src/services/engine_rules/curation), each a booleanDependencies parent, with what it decides.
 * Conditional pairs come from the compiled rules: CSR applicable = No closes / no longer requires the CSR items,
 * auditor's report qualified = Yes requires the remarks (a field in Ind AS, a table in C&I).
 */
import { RuleEngine } from './core/rules.js'
import type { Session } from './core/session.js'
import { mandatoryGap, type MarkScope } from './form-marks'

export interface MandatoryInput {
  concept: string
  label: string
  /** engine data type: string, textBlock, date, boolean, enum, token … */
  dataType: string
  scope: MarkScope
  /** the statement / note where it is entered (the first applicable ELR that presents it) */
  elrUri: string
  rules: string[]
  /** the rules' text, for "why is this required" */
  reasons: string[]
  /** required because of another answer ("mandatory if Yes / if entered") */
  conditional: boolean
  /** allowed values of a list (enumeration) element */
  enumerations: string[] | null
}

export interface RequiredTable {
  tableId: string
  title: string
  elrUri: string
  scope: MarkScope
  ruleId: string
  reason: string
}

export interface KeyAnswer {
  concept: string
  label: string
  elrUri: string | null
  /** the CY answer: true = Yes, false = No, null = not answered */
  value: boolean | null
  /** the items the answer decides (booleanDependencies children), labelled */
  decides: { concept: string; label: string }[]
  /** Yes or No: the answer under which those items are required */
  requiredWhen: boolean
  rules: string[]
}

type Rule = { id: string; status: string; text?: string; ast?: { type: string; when?: unknown; tables?: string[] } }
type Dependency = { parentConcept: string; condition: boolean; childConcepts: string[]; rules: string[] }
type Authority = {
  elrs: { uri: string }[]
  rules: { rules: Rule[]; booleanDependencies?: Dependency[]; keyAnswers?: string[] }
  has(q: string): boolean
  label(q: string): string
  isNumeric(q: string): boolean
  dataType(q: string): string
  enumerations(q: string): string[] | null
  conceptElrs(q: string): string[]
  table(id: string): { hypercube: string; presentationElr: string } | null
}
type View = {
  A: Authority
  filing: { meta: { firstFinancialYear?: boolean }; value(q: string, scope: MarkScope, dims: unknown[]): string | null }
  elrView(uri: string): { rows: { kind: string; concept?: string }[] }
  elrStatus(uri: string, scope: MarkScope): { applicable: boolean }
}

const years = (S: View): MarkScope[] => (S.filing.meta.firstFinancialYear ? ['CY'] : ['CY', 'PY'])

/** The empty non-numeric items the rules require now, in statement order, once per element and year. */
export function mandatoryInputs(session: Session): MandatoryInput[] {
  const S = session as unknown as View
  const A = S.A
  const ruleText = new Map(A.rules.rules.map((r) => [r.id, r.text ?? r.id]))
  const out: MandatoryInput[] = []
  const seen = new Set<string>()
  for (const elr of A.elrs) {
    for (const row of S.elrView(elr.uri).rows) {
      const q = row.concept
      if (row.kind !== 'item' || !q || A.isNumeric(q)) continue
      for (const scope of years(S)) {
        const key = `${q}|${scope}`
        if (seen.has(key)) continue
        const gap = mandatoryGap(session, q, scope, elr.uri)
        if (!gap) continue
        seen.add(key)
        out.push({
          concept: q,
          label: A.label(q),
          dataType: A.dataType(q),
          scope,
          elrUri: elr.uri,
          rules: gap.rules,
          reasons: gap.rules.map((id) => ruleText.get(id) ?? id),
          conditional: gap.conditional,
          enumerations: A.enumerations(q),
        })
      }
    }
  }
  return out
}

const CONDITIONAL_TABLES = new WeakMap<object, Set<string>>()
/** The executable "table is mandatory if …" rules (conditional tableRequired). */
function conditionalTableRules(A: Authority): Set<string> {
  let ids = CONDITIONAL_TABLES.get(A)
  if (!ids) CONDITIONAL_TABLES.set(A, (ids = new Set(A.rules.rules.filter((r) => r.status === 'EXECUTABLE' && r.ast?.type === 'tableRequired' && r.ast.when).map((r) => r.id))))
  return ids
}

/** Tables an answer makes mandatory that are still empty, per year (the rule engine's FAILs, not its warnings). */
export function requiredTables(session: Session, today?: string): RequiredTable[] {
  const S = session as unknown as View
  const A = S.A
  const only = conditionalTableRules(A)
  if (!only.size) return []
  const byId = new Map(A.rules.rules.map((r) => [r.id, r]))
  type Run = { results: { ruleId: string; scope: MarkScope | null; status: string }[] }
  const engine = new RuleEngine(A) as unknown as { run(filing: unknown, opts: { only: Set<string>; today?: string }): Run }
  const run = engine.run(S.filing, { only, ...(today ? { today } : {}) })
  return run.results
    .filter((x) => x.status === 'FAIL' && x.scope)
    .map((x) => {
      const r = byId.get(x.ruleId)!
      const tableId = r.ast!.tables![0]!
      const t = A.table(tableId)!
      return { tableId, title: A.label(t.hypercube), elrUri: t.presentationElr, scope: x.scope!, ruleId: r.id, reason: r.text ?? r.id }
    })
}

/** The curated key Yes/No answers of this taxonomy, with the current CY answer and what each decides. */
export function keyAnswers(session: Session): KeyAnswer[] {
  const S = session as unknown as View
  const A = S.A
  const deps = A.rules.booleanDependencies ?? []
  return (A.rules.keyAnswers ?? [])
    .filter((q) => A.has(q))
    .map((q) => {
      const own = deps.filter((d) => d.parentConcept === q)
      const children = [...new Set(own.flatMap((d) => d.childConcepts))].filter((c) => A.has(c))
      const v = S.filing.value(q, 'CY', [])
      return {
        concept: q,
        label: A.label(q),
        elrUri: A.conceptElrs(q).find((uri) => S.elrStatus(uri, 'CY').applicable) ?? null,
        value: v == null ? null : v === 'true',
        decides: children.map((c) => ({ concept: c, label: A.label(c) })),
        requiredWhen: own[0]?.condition ?? true,
        rules: [...new Set(own.flatMap((d) => d.rules))],
      }
    })
}
