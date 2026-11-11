/**
 * FixAgentService (Phase 10, docs/07, ADR-0012): "Ask AI" on one problem and the "Fix all with AI" loop.
 *
 * propose → engine check → diff cards → the user accepts (applied through the Session / MappingService, then
 * revalidated) or rejects (recorded). Nothing reaches the filing without the user. Every request (the exact payload),
 * response and decision is appended to ai/history.jsonl.
 *
 * Fix all: rounds of at most `perRound` problems (errors first, each problem tried once per run). A round's cards are
 * reviewed by the user; when none is left open, the filing is revalidated and the next round starts. It stops when the
 * filing has no errors, after `maxRounds`, when nothing was accepted in a round, when the AI proposes nothing, or when
 * the run's token / time budget is used up.
 *
 * AI runs only with the user's consent, a Groq key and a running sidecar, and never for a project built from the
 * repository's client fixtures. Deterministic quick fixes (ValidationService) never depend on any of this.
 * Electron-free; unit-tested with a fake proposer.
 */
import { randomUUID } from 'node:crypto'
import { aiEligible, AI_STOP_TEXT, type AiHistoryEntry, type AiPatch, type AiPatchCard, type AiProposal, type AiRun, type AiStatus, type AiStopReason, type AiView } from '@shared/ai'
import type { Problem } from '@shared/validation'
import type { AiHistory } from './ai-history'
import type { ContextBundleBuilder } from './context-bundle-builder'
import { NoProjectError, ValidationError } from './errors'
import type { PatchApplier } from './patch-applier'
import type { PatchVerifier } from './patch-verifier'
import { systemClock, type AiAvailability, type Clock, type FixProposer, type FixtureGuard, type ProjectAccess, type ProjectHandle } from './ports'
import { problemSignature, type ValidationService } from './validation-service'

export interface FixAgentBudget {
  maxRounds: number
  perRound: number
  /** tokens of a whole Fix all run */
  tokenBudget: number
  /** wall time of a whole Fix all run */
  timeBudgetMs: number
  /** tokens of one request (the sidecar stops the agent there) */
  perRequestTokens: number
  maxSteps: number
}

export const DEFAULT_FIX_BUDGET: FixAgentBudget = {
  maxRounds: 5,
  perRound: 10,
  tokenBudget: 250_000,
  timeBudgetMs: 15 * 60_000,
  perRequestTokens: 24_000,
  maxSteps: 6,
}

export interface AcceptOptions {
  /** the value the user typed (a patch whose source is "user", or an edited text) */
  input?: string | null
  /** the explicit confirmation a removal or a user-supplied value needs */
  confirmed?: boolean
}

interface ProposalState {
  proposal: AiProposal
  problem: Problem
  aliases: Map<string, string>
}

export class FixAgentService {
  private projectId: string | null = null
  private proposals: ProposalState[] = []
  private run: AiRun
  private startedAt = 0
  private attempted = new Set<string>()
  private cancelled = false
  private revision = 0
  private work: Promise<void> = Promise.resolve()
  private readonly budget: FixAgentBudget
  private readonly clock: Clock
  private readonly newId: () => string

  constructor(
    private readonly projects: ProjectAccess,
    private readonly validation: Pick<ValidationService, 'view' | 'run'>,
    private readonly builder: ContextBundleBuilder,
    private readonly proposer: FixProposer,
    private readonly verifier: PatchVerifier,
    private readonly applier: PatchApplier,
    private readonly history: AiHistory,
    private readonly availability: AiAvailability,
    private readonly guard: FixtureGuard,
    private readonly onChange: (view: AiView) => void = () => {},
    opts: { budget?: Partial<FixAgentBudget>; clock?: Clock; newId?: () => string } = {},
  ) {
    this.budget = { ...DEFAULT_FIX_BUDGET, ...opts.budget }
    this.clock = opts.clock ?? systemClock
    this.newId = opts.newId ?? (() => randomUUID().slice(0, 8))
    this.run = this.idleRun('single')
  }

  // ------------------------------------------------------------------------------------------------ queries
  view(): AiView {
    this.syncProject()
    return {
      revision: this.revision,
      status: this.status(),
      run: { ...this.run, elapsedMs: this.startedAt ? this.clock.now().getTime() - this.startedAt : 0 },
      proposals: this.proposals.map((s) => s.proposal),
    }
  }

  status(): AiStatus {
    const p = this.handle()
    if (!p) return off('no-project', 'Open a filing to use the AI fix agent.')
    const a = this.availability.state()
    if (!a.consent) return off('no-consent', 'AI is off: allow AI in Settings (data sent to Groq: see the consent notice).')
    if (a.sidecar !== 'ready') return off('sidecar', a.sidecar === 'starting' ? 'The AI engine is starting…' : 'The AI engine is not running (Output → Restart AI engine).')
    if (!a.keyConfigured) return off('no-key', 'AI is off: add a Groq API key in Settings.')
    const fixture = this.guard.match(p.content)
    if (fixture) return off('fixture', `This filing uses repository client data (${fixture}); it is never sent to an AI service.`)
    return { enabled: true, reason: null, message: null, model: a.model }
  }

  historyEntries(limit = 200): AiHistoryEntry[] {
    const p = this.handle()
    return p ? this.history.read(p, limit) : []
  }

  /** Resolves when the background work (a Fix all round) is done. For tests and orderly shutdown. */
  idle(): Promise<void> {
    return this.work
  }

  // ------------------------------------------------------------------------------------------------ commands
  async ask(problemId: string): Promise<AiView> {
    const p = this.ready()
    const problem = this.validation.view().problems.find((x) => x.id === problemId)
    if (!problem) throw new ValidationError(['This problem is no longer current. Validate again.'])
    if (!aiEligible(problem)) throw new ValidationError(['This problem is about identity data, which is never sent to the AI.'])
    this.begin('single')
    this.publish()
    const ok = await this.proposeFor(p, problem, null)
    if (ok && this.run.state === 'proposing') this.settleRound()
    this.publish()
    return this.view()
  }

  fixAll(): AiView {
    this.ready()
    this.begin('fix-all')
    this.work = this.nextRound().catch((err) => this.finish('error', err instanceof Error ? err.message : String(err)))
    this.publish()
    return this.view()
  }

  stop(): AiView {
    if (this.run.state === 'proposing' || this.run.state === 'reviewing') {
      this.cancelled = true
      this.finish('stopped')
    }
    return this.view()
  }

  async accept(cardId: string, opts: AcceptOptions = {}): Promise<AiView> {
    const p = this.projects.project()
    const { state, card } = this.card(cardId)
    if (card.status !== 'proposed') throw new ValidationError(['This patch was already decided.'])
    const input = opts.input?.trim() ? opts.input.trim() : null
    if (card.needsInput && !input) throw new ValidationError(['Type the value first.'])
    if (card.needsConfirm && !opts.confirmed) throw new ValidationError(['Confirm this change first.'])
    // the filing may have changed since the proposal: check again, with what the user typed
    const again = await this.verifier.verify(p, card.patch, state.problem, input)
    if (!again.ok) return this.fail(p, state, card, again.reason)
    try {
      await p.batch(() => this.applier.apply(p, card.patch, input))
    } catch (err) {
      return this.fail(p, state, card, err instanceof ValidationError ? err.problems.join(' ') : String(err))
    }
    card.status = 'accepted'
    card.decidedAt = this.clock.now().toISOString()
    card.before = again.card.before
    card.after = again.card.after
    this.history.append(p, { type: 'accept', proposalId: state.proposal.id, problemId: state.problem.id, cardId, op: card.patch.op, patch: card.patch, before: card.before, after: card.after, ...(input ? { input } : {}) })
    this.validation.run()
    this.afterDecision()
    return this.view()
  }

  reject(cardId: string, reason?: string): AiView {
    const p = this.projects.project()
    const { state, card } = this.card(cardId)
    if (card.status !== 'proposed') throw new ValidationError(['This patch was already decided.'])
    card.status = 'rejected'
    card.decidedAt = this.clock.now().toISOString()
    if (reason?.trim()) card.note = reason.trim().slice(0, 300)
    this.history.append(p, { type: 'reject', proposalId: state.proposal.id, problemId: state.problem.id, cardId, op: card.patch.op, patch: card.patch, ...(card.note ? { reason: card.note } : {}) })
    this.afterDecision()
    return this.view()
  }

  /** Removes proposals whose cards are all decided. */
  clear(): AiView {
    this.proposals = this.proposals.filter((s) => s.proposal.cards.some((c) => c.status === 'proposed'))
    if (this.run.state === 'done') this.run = this.idleRun(this.run.mode)
    this.publish()
    return this.view()
  }

  // ------------------------------------------------------------------------------------------------ the loop
  private async nextRound(): Promise<void> {
    if (this.run.state === 'done') return
    if (this.overBudget()) return
    const p = this.projects.project()
    const view = this.validation.run()
    const candidates = view.problems
      .filter((x) => x.severity === 'error' && aiEligible(x) && !this.attempted.has(attemptKey(x)))
      .slice(0, this.budget.perRound)
    if (!candidates.length) return this.finish(view.summary.errors === 0 ? 'clean' : 'no-proposals')
    this.run.round += 1
    this.run.state = 'proposing'
    this.run.message = `round ${this.run.round}: asking about ${candidates.length} problem(s)`
    this.publish()
    for (const problem of candidates) {
      if (this.cancelled || this.overBudget()) return
      this.attempted.add(attemptKey(problem))
      const ok = await this.proposeFor(p, problem, this.run.round)
      if (!ok) return
    }
    this.settleRound()
    this.publish()
  }

  /** After a round's (or a single ask's) proposals: wait for the user, or stop if there is nothing to review. */
  private settleRound(): void {
    if (this.pending().length) {
      this.run.state = 'reviewing'
      this.run.message = `${this.pending().length} patch(es) to review`
    } else this.finish('no-proposals')
  }

  private afterDecision(): void {
    if (this.run.state !== 'reviewing' || this.pending().length) return this.publish()
    if (this.run.mode === 'single') {
      const n = this.accepted(null)
      this.run.state = 'done'
      this.run.message = n ? `${n} patch(es) applied` : 'nothing accepted'
      return this.publish()
    }
    const accepted = this.accepted(this.run.round)
    if (!accepted) return this.finish('nothing-accepted')
    const errors = this.validation.run().summary.errors
    if (errors === 0) return this.finish('clean', `${accepted} accepted in round ${this.run.round}`)
    if (this.run.round >= this.run.maxRounds) return this.finish('max-rounds', `${errors} error(s) left`)
    this.work = this.nextRound().catch((err) => this.finish('error', err instanceof Error ? err.message : String(err)))
    this.publish()
  }

  /** One problem → one sidecar request → cards. false when the AI service failed (the run stops). */
  private async proposeFor(p: ProjectHandle, problem: Problem, round: number | null): Promise<boolean> {
    const t0 = this.clock.now().getTime()
    const id = this.newId()
    const proposal: AiProposal = {
      id, problemId: problem.id, problemMessage: problem.message, round, at: this.clock.now().toISOString(),
      summary: '', needsHuman: false, cards: [], dropped: [], model: null, steps: 0, tokens: 0, durationMs: 0,
    }
    const state: ProposalState = { proposal, problem, aliases: new Map() }
    try {
      const built = await this.builder.build(p, problem, { maxSteps: this.budget.maxSteps, maxTokens: this.budget.perRequestTokens })
      state.aliases = built.aliases
      this.history.append(p, { type: 'request', proposalId: id, problemId: problem.id, payload: built.bundle })
      const res = await this.proposer.propose(built.bundle)
      this.history.append(p, {
        type: 'response', proposalId: id, problemId: problem.id, summary: res.summary, patches: res.patches, dropped: res.dropped,
        needsHuman: res.needsHuman, usage: res.usage, model: res.model, steps: res.steps, toolCalls: res.toolCalls, stop: res.stop,
      })
      Object.assign(proposal, { summary: res.summary, needsHuman: res.needsHuman, model: res.model, steps: res.steps, tokens: res.usage.totalTokens })
      proposal.dropped.push(...res.dropped.map((d) => ({ patch: d.patch, reason: `sidecar: ${d.reason}` })))
      this.run.tokens += res.usage.totalTokens
      let i = 0
      for (const raw of res.patches) {
        const patch = unalias(raw, state.aliases)
        if (!patch) {
          proposal.dropped.push({ patch: raw, reason: 'sidecar: names a fact the app did not send' })
          continue
        }
        const v = await this.verifier.verify(p, patch, problem)
        if (!v.ok) proposal.dropped.push({ patch, reason: v.reason })
        else proposal.cards.push({ ...v.card, id: `${id}:${i++}`, proposalId: id, status: 'proposed' })
      }
      return true
    } catch (err) {
      const message = err instanceof ValidationError ? err.problems.join(' ') : err instanceof Error ? err.message : String(err)
      proposal.error = message
      this.history.append(p, { type: 'error', proposalId: id, problemId: problem.id, message })
      this.finish('error', message)
      return false
    } finally {
      proposal.durationMs = this.clock.now().getTime() - t0
      this.proposals.push(state)
      this.publish()
    }
  }

  // ------------------------------------------------------------------------------------------------ helpers
  private begin(mode: AiRun['mode']): void {
    if (this.run.state === 'proposing') throw new ValidationError(['The AI is already working on a request.'])
    this.run = { ...this.idleRun(mode), state: 'proposing' }
    this.startedAt = this.clock.now().getTime()
    this.attempted = new Set()
    this.cancelled = false
  }

  private finish(reason: AiStopReason, message: string | null = null): void {
    this.run.state = 'done'
    this.run.stopReason = reason
    this.run.message = message ?? AI_STOP_TEXT[reason]
    const p = this.handle()
    if (p && this.run.mode === 'fix-all') this.history.append(p, { type: 'run', mode: 'fix-all', rounds: this.run.round, stopReason: reason, tokens: this.run.tokens })
    this.publish()
  }

  private overBudget(): boolean {
    if (this.run.tokens >= this.budget.tokenBudget) {
      this.finish('budget-tokens')
      return true
    }
    if (this.clock.now().getTime() - this.startedAt >= this.budget.timeBudgetMs) {
      this.finish('budget-time')
      return true
    }
    return false
  }

  private pending(): AiPatchCard[] {
    const round = this.run.mode === 'fix-all' ? this.run.round : null
    return this.proposals.filter((s) => s.proposal.round === round).flatMap((s) => s.proposal.cards).filter((c) => c.status === 'proposed')
  }

  private accepted(round: number | null): number {
    return this.proposals.filter((s) => s.proposal.round === round).flatMap((s) => s.proposal.cards).filter((c) => c.status === 'accepted').length
  }

  private fail(p: ProjectHandle, state: ProposalState, card: AiPatchCard, reason: string): never {
    card.status = 'failed'
    card.note = reason
    card.decidedAt = this.clock.now().toISOString()
    this.history.append(p, { type: 'failed', proposalId: state.proposal.id, problemId: state.problem.id, cardId: card.id, op: card.patch.op, reason })
    this.afterDecision()
    throw new ValidationError([reason])
  }

  private card(cardId: string): { state: ProposalState; card: AiPatchCard } {
    this.syncProject()
    for (const state of this.proposals) {
      const card = state.proposal.cards.find((c) => c.id === cardId)
      if (card) return { state, card }
    }
    throw new ValidationError(['That patch is no longer listed.'])
  }

  private ready(): ProjectHandle {
    const p = this.projects.project()
    this.syncProject()
    const s = this.status()
    if (!s.enabled) throw new ValidationError([s.message ?? 'AI is off.'])
    return p
  }

  private handle(): ProjectHandle | null {
    try {
      return this.projects.project()
    } catch (err) {
      if (err instanceof NoProjectError) return null
      throw err
    }
  }

  /** Proposals belong to one filing: a different (or no) project starts clean. */
  private syncProject(): void {
    const id = this.handle()?.id ?? null
    if (id === this.projectId) return
    this.projectId = id
    this.proposals = []
    this.cancelled = true
    this.run = this.idleRun('single')
    this.startedAt = 0
  }

  private idleRun(mode: AiRun['mode']): AiRun {
    return {
      mode, state: 'idle', round: 0, maxRounds: this.budget?.maxRounds ?? DEFAULT_FIX_BUDGET.maxRounds, perRound: this.budget?.perRound ?? DEFAULT_FIX_BUDGET.perRound,
      tokens: 0, tokenBudget: this.budget?.tokenBudget ?? DEFAULT_FIX_BUDGET.tokenBudget, elapsedMs: 0,
      timeBudgetMs: this.budget?.timeBudgetMs ?? DEFAULT_FIX_BUDGET.timeBudgetMs, stopReason: null, message: null,
    }
  }

  private publish(): void {
    this.revision++
    this.onChange(this.view())
  }
}

function off(reason: AiStatus['reason'], message: string): AiStatus {
  return { enabled: false, reason, message, model: null }
}

/** A problem is tried once per Fix all run: by its signature (engine) or its text (MCA tool). */
function attemptKey(p: Problem): string {
  return problemSignature(p.id) ?? `mca:${p.message}`
}

/** The bundle's opaque fact ids → the filing's fact keys; null when the patch names an id the app never sent. */
function unalias(patch: AiPatch, aliases: Map<string, string>): AiPatch | null {
  const out: AiPatch = JSON.parse(JSON.stringify(patch))
  if (out.fact?.key) {
    const real = aliases.get(out.fact.key)
    if (real) out.fact.key = real
    else if (out.op === 'removeFact') return null
    else delete out.fact.key // a made-up id for a new fact: the element and year identify it
  }
  if (out.source?.kind === 'identity') {
    for (const t of out.source.terms) {
      const real = aliases.get(t.factKey)
      if (!real) return null
      t.factKey = real
    }
  }
  return out
}
