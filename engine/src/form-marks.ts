/**
 * Statement tree marks (docs/14 Step 2, webXBRL's E / L / T markers and red mandatory lines), from taxonomy data only:
 *   E   a text block (nonnum:textBlockItemType) presented in this statement / note only
 *   L   a linked text block: the same text block element is presented in other ELRs too (one fact shows in all)
 *   T   a dimensional table of the ELR (its hypercube in the presentation tree)
 * and, per year, whether an empty line is mandatory right now (core/mandatory-marks.js mandatoryCell: the MCA rules,
 * including "mandatory if Yes / > 0"), respecting applicability (closed year, not-applicable ELR or element).
 * Never keyed on ELR codes or label words.
 */
import { mandatoryCell } from './core/mandatory-marks.js'
import type { Session } from './core/session.js'

export type ElementMarker = 'E' | 'L'
export type TreeMarker = ElementMarker | 'T'
export type MarkScope = 'CY' | 'PY'

export interface TextBlockMark {
  marker: ElementMarker
  /** L: the other ELRs (codes) that present the same text block */
  linkedElrs: string[]
}

/** An empty line the MCA rules require for that year. */
export interface MandatoryGap {
  rules: string[]
  /** required because of another answer ("mandatory if Yes / if > 0 / if entered") */
  conditional: boolean
}

type Authority = {
  dataType(q: string): string
  conceptElrs(q: string): string[]
  elr(uri: string): { code: string } | null
  tablesInElr(uri: string): { id: string; hypercube: string; axes: unknown[] }[]
}
type Fact = { value?: string | null; nil?: boolean }
type View = {
  A: Authority
  filing: { meta: { firstFinancialYear?: boolean } }
  app: { cellStatus(filing: unknown, tab: string, q: string, scope: MarkScope): { applicable: boolean } }
  elrStatus(uri: string, scope: MarkScope): { applicable: boolean }
  getValue(q: string, scope: MarkScope): Fact | null
}

/** E or L for a text block element on this ELR; null for any other data type. */
export function textBlockMark(A: Authority, concept: string, elrUri: string): TextBlockMark | null {
  if (A.dataType(concept) !== 'textBlock') return null
  const linkedElrs = A.conceptElrs(concept)
    .filter((uri) => uri !== elrUri)
    .map((uri) => A.elr(uri)?.code)
    .filter((c): c is string => !!c)
  return { marker: linkedElrs.length ? 'L' : 'E', linkedElrs }
}

/** The dimensional table of this ELR whose hypercube is the given presentation node (T); null when it has none. */
export function elrTableOf(A: Authority, elrUri: string, hypercube: string): string | null {
  return A.tablesInElr(elrUri).find((t) => t.hypercube === hypercube && t.axes.length)?.id ?? null
}

const isEmpty = (f: Fact | null) => !f || f.nil || f.value == null || f.value === ''

/**
 * The rules that make this empty, non-dimensional line mandatory for the year, or null: it has a value, the year or
 * line is not applicable on this ELR, or no rule requires it now.
 */
export function mandatoryGap(session: Session, concept: string, scope: MarkScope, elrUri: string): MandatoryGap | null {
  const S = session as unknown as View
  if (scope === 'PY' && S.filing.meta.firstFinancialYear) return null
  if (!S.elrStatus(elrUri, scope).applicable || !S.app.cellStatus(S.filing, elrUri, concept, scope).applicable) return null
  if (!isEmpty(S.getValue(concept, scope))) return null
  const m = mandatoryCell(session, concept, scope) as { mandatory: boolean; rules: string[]; conditional: boolean }
  return m.mandatory ? { rules: m.rules, conditional: m.conditional } : null
}
