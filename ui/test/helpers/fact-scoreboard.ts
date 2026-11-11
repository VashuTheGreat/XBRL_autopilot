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
  /** per group (`groupOf`, e.g. the table): filed non-zero table facts, and how many of them we produced right */
  byGroup: Record<string, { filed: number; right: number }>
  /** filed non-zero table facts we did not produce right: "group concept period dims = value" */
  missed: string[]
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
export function scoreFacts(
  ours: ScoredFact[],
  filed: ScoredFact[],
  originOf: (f: ScoredFact) => string | null,
  sourceOf: (f: ScoredFact) => string = () => '',
  groupOf: (f: ScoredFact) => string = () => '',
): Scoreboard {
  const byKey = new Map(filed.filter(numeric).map((f) => [factKey(f), f]))
  const placeholder = placeholderMatcher(filed.filter(numeric))
  const board: Scoreboard = { byOrigin: {}, filedNonZero: { amount: 0, table: 0 }, rightNonZero: { amount: 0, table: 0 }, wrong: [], byGroup: {}, missed: [] }
  const rightFiled = new Set<ScoredFact>()
  for (const f of filed.filter(numeric)) if (Number(f.value) !== 0) board.filedNonZero[kindOf(f)]++
  for (const f of ours.filter(numeric)) {
    const origin = originOf(f)
    if (!origin) continue
    const filedFact = placeholder(f) ?? byKey.get(factKey(f))
    const v = verdict(f, filedFact)
    const kind = kindOf(f)
    const t = ((board.byOrigin[origin] ??= { amount: empty(), table: empty() })[kind])
    t[v]++
    if (v === 'right' && filedFact && Number(filedFact.value) !== 0 && !rightFiled.has(filedFact)) {
      board.rightNonZero[kind]++
      rightFiled.add(filedFact)
    }
    if (v === 'wrong') board.wrong.push(`${origin} ${kind} ${sourceOf(f)} ${f.concept} ${f.period.date ?? f.period.end} ${JSON.stringify(f.dims.map((d) => d.member ?? d.typed))}: ${f.value} vs ${filedFact!.value}`)
  }
  for (const f of filed.filter((x) => numeric(x) && Number(x.value) !== 0 && kindOf(x) === 'table')) {
    const g = groupOf(f)
    const tally = (board.byGroup[g] ??= { filed: 0, right: 0 })
    tally.filed++
    if (rightFiled.has(f)) tally.right++
    else board.missed.push(`${g} ${f.concept} ${f.period.date ?? f.period.end} ${JSON.stringify(f.dims.map((d) => d.member ?? d.typed))} = ${f.value}`)
  }
  return board
}

const NUMBERED = /^(.*?)(\d+)Member$/

/**
 * Numbered members ("Other financial assets at amortised cost, class 1 … 10") are placeholders: MCA accepts any
 * numbering, so a fact of ours under one is compared with the filer's fact of the same family, element, period and
 * other members that has its value (each filed fact once). As src/evaluation/coverage_eval.py align_placeholders.
 */
function placeholderMatcher(filed: ScoredFact[]): (f: ScoredFact) => ScoredFact | undefined {
  const groupOf = (f: ScoredFact): string | null => {
    const i = f.dims.findIndex((d) => d.member && NUMBERED.test(d.member.split(':').pop()!))
    if (i < 0) return null
    const d = f.dims[i]!
    const rest = f.dims.filter((_, j) => j !== i)
    return `${factKey({ ...f, dims: rest })}|${d.axis}|${NUMBERED.exec(d.member!.split(':').pop()!)![1]}`
  }
  const groups = new Map<string, ScoredFact[]>()
  for (const f of filed) {
    const g = groupOf(f)
    if (g) groups.set(g, [...(groups.get(g) ?? []), f])
  }
  const taken = new Set<ScoredFact>()
  return (f) => {
    const g = groupOf(f)
    // the filed fact of the same member first, when it has our value
    const same = g ? groups.get(g)?.filter((x) => !taken.has(x) && verdict(f, x) === 'right') : undefined
    const hit = same?.find((x) => factKey(x) === factKey(f)) ?? same?.[0]
    if (hit) taken.add(hit)
    return hit
  }
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
    ...Object.entries(b.byGroup)
      .filter(([g]) => g)
      .sort((x, y) => y[1].filed - x[1].filed)
      .map(([g, t]) => `  ${g.padEnd(64)} ${String(t.right).padStart(4)} of ${String(t.filed).padStart(4)}`),
  ].join('\n')
}
