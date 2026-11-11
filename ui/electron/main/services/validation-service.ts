/**
 * ValidationService (Phase 9): live validation of the open filing for the Problems panel.
 *
 * Runs the engine's gate (document checks, facts, dimensions, calculation, MCA business rules of the filing's
 * taxonomy) debounced after every project change, and turns its issues into Problems with a location (statement,
 * row, table, period) and the Excel cell the value came from. Only approved mappings carry a fact: suggested and
 * rejected entries (auto-tagging) are never a source. Quick fixes are the engine's deterministic fixes (fixes.js),
 * applied through the session. Errors imported from the MCA Validation Tool are explained (mca-errors.js) and kept in
 * the project (mca-errors/<name>.txt). Electron-free: unit-tested without a window.
 * Measured: about 0.3 s per run on the 2,666-fact Dixon filing, so it runs on the main process.
 */
import { explainMcaErrors, fixFor } from '@xap/engine'
import type { MappingView } from '@shared/editor'
import type { Problem, ProblemFamily, ProblemLocation, ProblemSeverity, RuleCoverageSummary, ValidationView } from '@shared/validation'
import type { CellRef } from '@shared/workbook'
import { NoProjectError, ValidationError } from './errors'
import type { ProjectAccess, ProjectHandle } from './ports'

/** An issue as the engine's gate reports it (engine/src/core/gate.js). */
export interface GateIssue {
  severity: 'ERROR' | 'WARNING' | 'INFO'
  code: string
  message: string
  ruleId?: string
  factKey?: string | null
  concept?: string | null
  scope?: string | null
  tableId?: string | null
  location?: {
    kind?: string
    elrUri?: string | null
    tableId?: string | null
    conceptQName?: string | null
    scope?: string | null
    cellId?: string | null
    factKey?: string | null
  } | null
}

type Authority = {
  rules: { rules: { id: string; status: string; ast?: { handler?: string } }[] }
  elr(uri: string): { code: string; title?: string; definition?: string } | null
  conceptElrs(q: string): string[]
  has(q: string): boolean
  label(q: string): string
  qnameOfLocal(local: string): string | null
}

const DOCUMENT_CODES = new Set(['schemaRef', 'cin.missing', 'cin.format', 'periods', 'reportType', 'empty', 'rules.corpus'])
const SEVERITY: Record<GateIssue['severity'], ProblemSeverity> = { ERROR: 'error', WARNING: 'warning', INFO: 'info' }
const ORDER: Record<ProblemSeverity, number> = { error: 0, warning: 1, info: 2 }
const MCA_PREFIX = 'mca-'

export interface ValidationServiceOptions {
  /** debounce after a change (ms) */
  delayMs?: number
  today?: () => string
  now?: () => Date
}

export class ValidationService {
  private current: ValidationView = emptyView(0)
  private issues = new Map<string, GateIssue>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private revision = 0
  private readonly delayMs: number
  private readonly today: () => string
  private readonly now: () => Date

  constructor(
    private readonly projects: ProjectAccess,
    private readonly mappings: () => MappingView[],
    private readonly onChange: (view: ValidationView) => void = () => {},
    opts: ValidationServiceOptions = {},
  ) {
    this.delayMs = opts.delayMs ?? 400
    this.now = opts.now ?? (() => new Date())
    this.today = opts.today ?? (() => this.now().toISOString().slice(0, 10))
  }

  view(): ValidationView {
    return this.current
  }

  /** Revalidate after the project changed: debounced, so a burst of edits (Accept all) gives one run. */
  schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.run()
    }, this.delayMs)
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Validates now; an empty view when no filing is open. */
  run(): ValidationView {
    const p = this.handle()
    if (!p) {
      this.issues.clear()
      return this.publish(emptyView(++this.revision))
    }
    const t0 = Date.now()
    const gate = p.session.validate({ today: this.today() }) as { issues: GateIssue[] }
    const A = p.authority.authority as unknown as Authority
    const cells = this.cellsByFact()
    const problems: Problem[] = []
    const seen = new Map<string, number>()
    this.issues.clear()
    for (const issue of gate.issues) {
      const base = issueSignature(issue)
      const n = (seen.get(base) ?? 0) + 1
      seen.set(base, n)
      const id = `engine:${base}#${n}`
      this.issues.set(id, issue)
      problems.push(this.toProblem(id, issue, A, cells, p))
    }
    problems.push(...this.mcaProblems(p, A, cells))
    problems.sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
    const count = (s: ProblemSeverity) => problems.filter((x) => x.severity === s).length
    const latest = latestMca(p)
    return this.publish({
      revision: ++this.revision,
      at: this.now().toISOString(),
      durationMs: Date.now() - t0,
      summary: { errors: count('error'), warnings: count('warning'), info: count('info') },
      problems,
      coverage: coverageOf(A),
      mca: latest ? { file: latest.name.slice(MCA_PREFIX.length + 16).replace(/\.txt$/, ''), count: problems.filter((x) => x.source === 'mca').length } : null,
    })
  }

  /** Applies the deterministic quick fix of a problem from the latest run, then revalidates. */
  applyFix(problemId: string): ValidationView {
    const p = this.require()
    const issue = this.issues.get(problemId)
    if (!issue) throw new ValidationError(['This problem is no longer current. Validate again.'])
    const fix = fixFor(p.session as never, issue as never) as { apply(): void } | null
    if (!fix) throw new ValidationError(['There is no quick fix for this problem.'])
    fix.apply()
    p.touch()
    return this.run()
  }

  /** Keeps the MCA Validation Tool's error list in the project and shows it as problems. */
  importMcaErrors(text: string, fileName = 'pasted'): ValidationView {
    const p = this.require()
    if (!text.trim()) throw new ValidationError(['The MCA error list is empty.'])
    const stamp = this.now().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
    const safe = fileName.replace(/[^\w.-]+/g, '_').replace(/\.txt$/i, '').slice(0, 60) || 'pasted'
    // .axbrl entry mca-errors/<key> (the key carries .txt, as axbrl.ts reads it back)
    p.content.mcaErrors[`${MCA_PREFIX}${stamp}-${safe}.txt`] = text
    p.touch()
    return this.run()
  }

  /** Removes every imported MCA error list from the project. */
  clearMcaErrors(): ValidationView {
    const p = this.require()
    for (const k of Object.keys(p.content.mcaErrors)) if (k.startsWith(MCA_PREFIX)) delete p.content.mcaErrors[k]
    p.touch()
    return this.run()
  }

  // ------------------------------------------------------------------------------------------------ internals
  private publish(view: ValidationView): ValidationView {
    this.current = view
    this.onChange(view)
    return view
  }

  private handle(): ProjectHandle | null {
    try {
      return this.projects.project()
    } catch (err) {
      if (err instanceof NoProjectError) return null
      throw err
    }
  }

  private require(): ProjectHandle {
    return this.projects.project()
  }

  /** fact key → the Excel cell it was tagged from (approved mappings only). */
  private cellsByFact(): Map<string, CellRef> {
    const out = new Map<string, CellRef>()
    for (const m of this.mappings()) if (m.status === 'approved' && m.factKey) out.set(m.factKey, m.cell as CellRef)
    return out
  }

  private toProblem(id: string, issue: GateIssue, A: Authority, cells: Map<string, CellRef>, p: ProjectHandle): Problem {
    const loc = issue.location ?? null
    const factKey = issue.factKey ?? loc?.factKey ?? (loc?.kind === 'cell' ? loc.cellId ?? null : null)
    const elrUri = loc?.elrUri ?? null
    const elr = elrUri ? A.elr(elrUri) : null
    const location: ProblemLocation | null = loc
      ? {
          kind: (loc.kind as ProblemLocation['kind']) ?? 'concept',
          elrUri,
          elrCode: elr?.code ?? null,
          elrTitle: elr ? elr.title ?? elr.definition ?? null : null,
          tableId: loc.tableId ?? issue.tableId ?? null,
          concept: loc.conceptQName ?? issue.concept ?? null,
          scope: loc.scope ?? issue.scope ?? null,
          factKey,
        }
      : null
    let fix: Problem['fix'] = null
    try {
      const f = fixFor(p.session as never, issue as never) as { label: string } | null
      if (f) fix = { label: f.label }
    } catch {
      fix = null // a fix that cannot be computed is simply not offered
    }
    return {
      id,
      severity: SEVERITY[issue.severity],
      source: 'engine',
      family: familyOf(issue, A),
      code: issue.code,
      ruleId: issue.ruleId ?? null,
      message: issue.message,
      location,
      cell: factKey ? cells.get(factKey) ?? null : null,
      fix,
    }
  }

  private mcaProblems(p: ProjectHandle, A: Authority, cells: Map<string, CellRef>): Problem[] {
    const latest = latestMca(p)
    if (!latest) return []
    const items = explainMcaErrors(latest.text, A as never) as {
      n: number | null; raw: string; code: string; title: string; meaning: string; cause: string; fix: string; concept: string | null
    }[]
    const filing = p.session.filing as { factsOf(q: string): { key: string; nil: boolean }[] }
    return items.map((x, i) => {
      const fact = x.concept ? filing.factsOf(x.concept).find((f) => !f.nil) ?? null : null
      const elrUri = x.concept && A.has(x.concept) ? A.conceptElrs(x.concept)[0] ?? null : null
      const elr = elrUri ? A.elr(elrUri) : null
      return {
        id: `mca:${i}`,
        severity: 'error' as const,
        source: 'mca' as const,
        family: 'mca' as const,
        code: x.code,
        ruleId: null,
        message: `${x.n != null ? `${x.n}) ` : ''}${x.raw}`,
        location: x.concept
          ? { kind: 'concept' as const, elrUri, elrCode: elr?.code ?? null, elrTitle: elr ? elr.title ?? elr.definition ?? null : null, tableId: null, concept: x.concept, scope: null, factKey: fact?.key ?? null }
          : null,
        cell: fact ? cells.get(fact.key) ?? null : null,
        fix: null,
        explanation: { title: x.title, meaning: x.meaning, cause: x.cause, fix: x.fix },
      }
    })
  }
}

/** What identifies an issue across runs (code, fact, element, year, table); problem ids are `engine:<signature>#n`. */
export function issueSignature(issue: Pick<GateIssue, 'code' | 'factKey' | 'concept' | 'scope' | 'tableId' | 'location'>): string {
  return [issue.code, issue.factKey ?? issue.location?.cellId ?? '', issue.concept ?? '', issue.scope ?? '', issue.tableId ?? ''].join('|')
}

/** The signature inside an engine problem id; null for MCA problems. */
export function problemSignature(problemId: string): string | null {
  if (!problemId.startsWith('engine:')) return null
  const i = problemId.lastIndexOf('#')
  return problemId.slice('engine:'.length, i < 0 ? undefined : i)
}

function emptyView(revision: number): ValidationView {
  return {
    revision,
    at: null,
    durationMs: 0,
    summary: { errors: 0, warnings: 0, info: 0 },
    problems: [],
    coverage: { executable: 0, reviewOnly: 0, unimplemented: 0, notApplicable: 0, executableShare: null },
    mca: null,
  }
}

function familyOf(issue: GateIssue, A: Authority): ProblemFamily {
  const c = issue.code
  if (c.startsWith('rule.')) {
    const handler = A.rules.rules.find((r) => r.id === issue.ruleId)?.ast?.handler
    return handler === 'calc-parent-child' ? 'calculation' : 'rule'
  }
  if (c.startsWith('review.')) return 'review'
  if (c.startsWith('unimplemented.') || c.startsWith('limitation.')) return 'coverage'
  if (c.startsWith('dim.')) return 'dimension'
  if (DOCUMENT_CODES.has(c)) return 'document'
  return 'fact'
}

/** Rule coverage of the filing's taxonomy (same measure as the coverage report, ADR-0011). */
export function coverageOf(A: Authority): RuleCoverageSummary {
  const n = (s: string) => A.rules.rules.filter((r) => r.status === s).length
  const executable = n('EXECUTABLE'), reviewOnly = n('REVIEW_ONLY_EXTERNAL_DATA'), unimplemented = n('UNIMPLEMENTED'), notApplicable = n('NOT_APPLICABLE')
  const counted = executable + reviewOnly + unimplemented
  return { executable, reviewOnly, unimplemented, notApplicable, executableShare: counted ? Math.round((executable / counted) * 10000) / 10000 : null }
}

function latestMca(p: ProjectHandle): { name: string; text: string } | null {
  const names = Object.keys(p.content.mcaErrors).filter((k) => k.startsWith(MCA_PREFIX)).sort()
  const name = names.at(-1)
  return name ? { name, text: p.content.mcaErrors[name]! } : null
}
