/**
 * Fact scoreboard (ADR-0013 "the coverage evaluation is the scoreboard", engine side): the numeric facts of a filing we
 * produced, compared with a filed instance by (element, period, members), per origin and kind. Pure.
 *
 * Verdicts, on the filed fact's `decimals` (as src/evaluation/coverage_eval.py):
 * - right: within half a unit of the last place (decimals=-3 → ±₹500);
 * - near:  within one unit and a half (another rounding, or a filer's adjustment);
 * - wrong: further off;
 * - extra: a fact the filer did not file.
 */
import { dimKey } from '@xap/engine'

export interface ScoredFact {
  concept: string
  period: { type: string; date?: string; start?: string; end?: string }
  dims: { axis: string; member?: string; typed?: string }[]
  value: string | null
  nil?: boolean
  decimals?: string | null
}

export type Verdict = 'right' | 'near' | 'wrong' | 'extra'
export type Kind = 'amount' | 'table'

export interface Tally {
  right: number
  near: number
  wrong: number
  extra: number
}

export interface Scoreboard {
  /** origin → kind → tally */
  byOrigin: Record<string, Record<Kind, Tally>>
  /** filed facts of each kind (non-zero numeric), and how many of them we produced right from any origin */
  filedNonZero: Record<Kind, number>
  rightNonZero: Record<Kind, number>
  /** what went wrong, for the report: "origin kind concept dims: ours vs filed" */
  wrong: string[]
}

export const factKey = (f: ScoredFact) =>
  `${f.concept}|${f.period.type === 'instant' ? `I${f.period.date}` : `D${f.period.start}/${f.period.end}`}|${dimKey(f.dims)}`

const numeric = (f: ScoredFact) => !f.nil && f.value !== null && f.value !== '' && Number.isFinite(Number(f.value))
const kindOf = (f: ScoredFact): Kind => (f.dims.length ? 'table' : 'amount')
const empty = (): Tally => ({ right: 0, near: 0, wrong: 0, extra: 0 })

export function verdict(ours: ScoredFact, filed: ScoredFact | undefined): Verdict {
  if (!filed) return 'extra'
  const d = filed.decimals && filed.decimals !== 'INF' ? Number(filed.decimals) : 0
  const unit = 10 ** -d
  const diff = Math.abs(Number(ours.value) - Number(filed.value))
  return diff <= unit / 2 ? 'right' : diff <= unit * 1.5 ? 'near' : 'wrong'
}

/**
 * Scores every numeric fact of `ours` (classified by `originOf`; null = not scored, e.g. the wizard's own facts)
 * against `filed`. `sourceOf` names where a fact came from in the report (its Excel cell).
 */
export function scoreFacts(ours: ScoredFact[], filed: ScoredFact[], originOf: (f: ScoredFact) => string | null, sourceOf: (f: ScoredFact) => string = () => ''): Scoreboard {
  const byKey = new Map(filed.filter(numeric).map((f) => [factKey(f), f]))
  const board: Scoreboard = { byOrigin: {}, filedNonZero: { amount: 0, table: 0 }, rightNonZero: { amount: 0, table: 0 }, wrong: [] }
  for (const f of filed.filter(numeric)) if (Number(f.value) !== 0) board.filedNonZero[kindOf(f)]++
  for (const f of ours.filter(numeric)) {
    const origin = originOf(f)
    if (!origin) continue
    const filedFact = byKey.get(factKey(f))
    const v = verdict(f, filedFact)
    const kind = kindOf(f)
    const t = ((board.byOrigin[origin] ??= { amount: empty(), table: empty() })[kind])
    t[v]++
    if (v === 'right' && filedFact && Number(filedFact.value) !== 0) board.rightNonZero[kind]++
    if (v === 'wrong') board.wrong.push(`${origin} ${kind} ${sourceOf(f)} ${f.concept} ${f.period.date ?? f.period.end} ${JSON.stringify(f.dims.map((d) => d.member ?? d.typed))}: ${f.value} vs ${filedFact!.value}`)
  }
  return board
}

/** The scoreboard as a text table (for the test log and docs/06). */
export function scoreboardText(b: Scoreboard): string {
  const rows = Object.entries(b.byOrigin).flatMap(([o, k]) =>
    (['amount', 'table'] as Kind[]).map((kind) => `${o.padEnd(8)} ${kind.padEnd(7)} ${String(k[kind].right).padStart(5)} ${String(k[kind].near).padStart(5)} ${String(k[kind].wrong).padStart(5)} ${String(k[kind].extra).padStart(5)}`),
  )
  return [
    'origin   kind    right  near wrong extra',
    ...rows,
    `non-zero filed amounts right: ${b.rightNonZero.amount} of ${b.filedNonZero.amount}; table amounts right: ${b.rightNonZero.table} of ${b.filedNonZero.table}`,
  ].join('\n')
}
