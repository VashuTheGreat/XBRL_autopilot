/**
 * ContextBundleBuilder (Phase 10, ADR-0012): what the AI fix agent gets for one problem, and nothing more.
 *
 * Sent: the problem (rule text + executable form, location, the MCA error text), the filing's related facts (the
 * problem's own fact, the element's other years, the elements its rule names, its calculation parents / children,
 * the facts of its statement), the Excel rows those facts came from, and the filing's periods / rounding level.
 * Never sent: the CIN, the company name, identity elements (names, PAN, DIN, addresses …), text blocks other than the
 * problem's own fact, text longer than 200 characters, typed members that are not sequence numbers, file paths.
 * Fact keys stay on this machine: the bundle names facts by opaque ids (f1, f2 …) that `aliases` maps back.
 * Electron-free; unit-tested.
 */
import type { MappingView } from '@shared/editor'
import { capText, isIdentityElement, scrubText, typedMemberForAi } from '@shared/privacy'
import type { Problem } from '@shared/validation'
import type { CellRef } from '@shared/workbook'
import { columnLetter } from '@shared/workbook'
import type { ColumnPeriodService } from './column-period-service'
import { ValidationError } from './errors'
import type { FixBundle, FixBundleFact, FixBundleSource, ProjectHandle } from './ports'
import type { SourceService } from './source-service'

export const MAX_BUNDLE_FACTS = 300
export const MAX_SOURCE_ROWS = 60
export const MAX_LABEL_ROWS = 3
const STOP = new Set(['and', 'of', 'the', 'for', 'to', 'in', 'on', 'a', 'an'])
const words = (t: string) => t.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !STOP.has(w))

/** "- Reserves & Surplus" reads like "Reserves and surplus": every word of the element's label, few others. */
export function labelMatches(rowLabel: string, elementLabel: string): boolean {
  const want = words(elementLabel)
  const have = words(rowLabel)
  if (!want.length || have.length > want.length + 3) return false
  return want.every((w) => have.includes(w))
}
const QNAME = /\b[a-z][a-z0-9-]*:[A-Z][A-Za-z0-9_]+/g

type Fact = {
  key: string
  concept: string
  period: { type: string; date?: string; start?: string; end?: string }
  dims: { axis: string; member?: string; typed?: string }[]
  value: string | null
  nil: boolean
  decimals: string | null
  origin?: string
}

type Engine = {
  A: {
    label(q: string): string
    dataType(q: string): string
    conceptElrs(q: string): string[]
    elr(uri: string): { code: string } | null
    rules: { rules: { id: string; text?: string; implementation?: string; ast?: unknown }[] }
    json: { calculation?: Record<string, { from: string; to: string }[]> }
  }
  filing: {
    all(): Fact[]
    facts: Map<string, Fact>
    scopeOf(p: Fact['period']): string
    meta: {
      name?: string
      cin?: string
      reportType?: string
      level?: string
      firstFinancialYear?: boolean
      periods: { cy: { start: string; end: string }; py: { start: string; end: string } | null }
    }
  }
  displayOf(f: Fact): string
}

export interface BuiltBundle {
  bundle: FixBundle
  /** opaque id in the bundle → fact key in the filing (patches come back with the ids) */
  aliases: Map<string, string>
  /** the problem's id in the bundle → its real id */
  problemAlias: string
}

export interface BundleOptions {
  maxSteps?: number
  maxTokens?: number
}

export class ContextBundleBuilder {
  constructor(
    private readonly sources: SourceService,
    private readonly columns: ColumnPeriodService,
    private readonly mappings: () => MappingView[],
  ) {}

  async build(p: ProjectHandle, problem: Problem, opts: BundleOptions = {}): Promise<BuiltBundle> {
    const S = p.session as unknown as Engine
    const A = S.A
    const meta = S.filing.meta
    const known = { cin: meta.cin ?? p.content.manifest.company.cin, company: meta.name ?? p.content.manifest.company.name }
    const scrub = (t: string | null | undefined, max = 4000) => (t == null ? null : capText(scrubText(t, known), max))
    const loc = problem.location
    if (loc?.concept && isIdentityElement(loc.concept)) throw new ValidationError(['This problem is about identity data, which is never sent to the AI.'])

    // ---- facts: own, same element, rule elements, calculation neighbours, then the statement's facts
    const own = loc?.factKey ?? null
    const rule = problem.ruleId ? A.rules.rules.find((r) => r.id === problem.ruleId) ?? null : null
    const related = new Set<string>()
    if (loc?.concept) related.add(loc.concept)
    for (const q of JSON.stringify(rule?.ast ?? null).match(QNAME) ?? []) related.add(q)
    if (loc?.concept) for (const arcs of Object.values(A.json.calculation ?? {})) for (const a of arcs) {
      if (a.from === loc.concept) related.add(a.to)
      if (a.to === loc.concept) related.add(a.from)
    }
    const rank = (f: Fact) => (f.key === own ? 0 : related.has(f.concept) ? 1 : 2)
    const inElr = (f: Fact) => !!loc?.elrUri && A.conceptElrs(f.concept).includes(loc.elrUri)
    const allowed = (f: Fact) => !isIdentityElement(f.concept) && (A.dataType(f.concept) !== 'textBlock' || f.key === own)
    const picked = S.filing.all()
      .filter((f) => (f.key === own || related.has(f.concept) || inElr(f)) && allowed(f))
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, MAX_BUNDLE_FACTS)

    const aliases = new Map<string, string>()
    const aliasOf = new Map<string, string>()
    const alias = (key: string) => {
      let a = aliasOf.get(key)
      if (!a) {
        a = `f${aliasOf.size + 1}`
        aliasOf.set(key, a)
        aliases.set(a, key)
      }
      return a
    }
    const cellOf = new Map<string, CellRef>()
    for (const m of this.mappings()) if (m.status === 'approved' && m.factKey) cellOf.set(m.factKey, m.cell)
    const elrCodes = (q: string) => [...new Set(A.conceptElrs(q).map((u) => A.elr(u)?.code).filter((c): c is string => !!c))]

    const facts: FixBundleFact[] = picked.map((f) => {
      const text = A.dataType(f.concept) === 'textBlock' || !/^(monetary|decimal|shares|perShare|percent|pure)$/.test(A.dataType(f.concept))
      const cap = (v: string | null) => (v == null ? null : text ? capText(scrubText(v, known)) : v)
      return {
        key: alias(f.key),
        concept: f.concept,
        label: A.label(f.concept),
        dataType: A.dataType(f.concept),
        scope: (S.filing.scopeOf(f.period) as FixBundleFact['scope']) ?? null,
        period: f.period.type === 'instant' ? f.period.date ?? '' : `${f.period.start}..${f.period.end}`,
        dims: f.dims.map((d) => ({ axis: d.axis, member: d.member ?? typedMemberForAi(String(d.typed ?? '')) })),
        value: cap(f.nil ? null : f.value),
        display: cap(f.nil ? null : S.displayOf(f)),
        nil: !!f.nil,
        decimals: f.decimals ?? null,
        origin: f.origin ?? null,
        cell: cellOf.get(f.key) ?? null,
        elrs: elrCodes(f.concept),
      }
    })

    // ---- the Excel rows the facts came from (the problem's own cell first)
    const cells: CellRef[] = []
    const addCell = (c: CellRef | null | undefined) => {
      if (c && !cells.some((x) => x.workbook === c.workbook && x.sheet === c.sheet && x.ref === c.ref)) cells.push(c)
    }
    addCell(problem.cell)
    for (const f of picked) addCell(cellOf.get(f.key))
    // an element with no tagged cell: the workbook rows labelled like it (where its amount most likely is)
    if (loc?.concept && !problem.cell && ![...cellOf.entries()].some(([k]) => S.filing.facts.get(k)?.concept === loc.concept)) {
      for (const c of await this.rowsLabelled(A.label(loc.concept))) addCell(c)
    }
    const sources: FixBundleSource[] = []
    for (const c of cells.slice(0, MAX_SOURCE_ROWS)) {
      const row = await this.sourceRow(c, known).catch(() => null)
      if (row) sources.push(row)
    }

    const problemAlias = 'p1'
    const P = meta.periods
    const bundle: FixBundle = {
      taxonomy: p.authority.taxonomyId,
      problem: {
        id: problemAlias,
        severity: problem.severity,
        family: problem.family,
        code: problem.code,
        ruleId: problem.ruleId,
        message: scrub(problem.message)!,
        elrCode: loc?.elrCode ?? null,
        elrTitle: loc?.elrTitle ?? null,
        concept: loc?.concept ?? null,
        scope: loc?.scope ?? null,
        factKey: own && aliasOf.has(own) ? aliasOf.get(own)! : null,
        cell: problem.cell ?? null,
        rule: rule ? { id: rule.id, text: rule.text ?? '', implementation: rule.implementation ?? null, ast: rule.ast ?? null } : null,
        mcaText: problem.source === 'mca' ? scrub(problem.message) : null,
        explanation: problem.explanation
          ? { title: scrub(problem.explanation.title, 500)!, meaning: scrub(problem.explanation.meaning, 2000)!, cause: scrub(problem.explanation.cause, 2000)!, fix: scrub(problem.explanation.fix, 2000)! }
          : null,
      },
      facts,
      sources,
      meta: {
        reportType: meta.reportType ?? null,
        cyStart: P.cy.start,
        cyEnd: P.cy.end,
        pyStart: P.py?.start ?? null,
        pyEnd: P.py?.end ?? null,
        level: meta.level ?? 'Actual',
        firstFinancialYear: !!meta.firstFinancialYear,
      },
      options: { maxSteps: opts.maxSteps ?? 6, maxTokens: opts.maxTokens ?? 24_000 },
    }
    return { bundle, aliases, problemAlias }
  }

  /**
   * Every workbook row whose label reads like `label` (at most MAX_LABEL_ROWS), named by its current-year cell (else
   * previous-year, else first number): never a "Note No." column, which a model would otherwise cite as the amount.
   */
  private async rowsLabelled(label: string): Promise<CellRef[]> {
    const out: CellRef[] = []
    for (const wb of await this.sources.workbooks().catch(() => [])) {
      for (const sheet of wb.sheets) {
        for (const c of sheet.cells) {
          if (out.length >= MAX_LABEL_ROWS) return out
          if (typeof c.v !== 'string' || !labelMatches(c.v, label)) continue
          const nums = sheet.cells.filter((x) => x.r === c.r && x.c > c.c && typeof x.v === 'number').sort((a, b) => a.c - b.c)
          const refs = nums.map((n) => ({ workbook: wb.source, sheet: sheet.name, ref: `${columnLetter(n.c)}${n.r + 1}` }))
          const scopes = await Promise.all(refs.map((r) => this.columns.of(r).then((x) => x.scope).catch(() => null)))
          const pick = refs[scopes.indexOf('CY')] ?? refs[scopes.indexOf('PY')] ?? null
          if (pick) out.push(pick)
        }
      }
    }
    return out
  }

  /** A cell's row: its label and the row's other number cells, with their column's period when known. */
  private async sourceRow(cell: CellRef, known: { cin?: string | null; company?: string | null }): Promise<FixBundleSource | null> {
    const { sheet, at, cell: model } = await this.sources.cell(cell)
    const label = await this.sources.rowLabel(cell)
    const neighbours: FixBundleSource['neighbours'] = []
    for (const c of sheet.cells.filter((x) => x.r === at.r && typeof x.v === 'number').sort((a, b) => a.c - b.c).slice(0, 40)) {
      const ref = `${columnLetter(c.c)}${c.r + 1}`
      const period = await this.columns.of({ ...cell, ref }).catch(() => null)
      neighbours.push({ ref, value: c.v as number, column: period?.scope ?? null })
    }
    const v = model?.v ?? null
    return {
      cell: { workbook: cell.workbook, sheet: cell.sheet, ref: cell.ref },
      label: label ? capText(scrubText(label, known)) : null,
      value: typeof v === 'string' ? capText(scrubText(v, known)) : (v as number | boolean | null),
      neighbours,
    }
  }
}
