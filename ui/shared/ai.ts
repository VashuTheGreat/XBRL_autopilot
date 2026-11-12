/** AI fix agent read-model shared by main and renderer (Phase 10, docs/07-ai-fix-agent.md, ADR-0012). */
import { isIdentityElement } from './privacy'
import type { Problem } from './validation'
import type { CellRef } from './workbook'

export type AiPatchOp = 'setValue' | 'setNil' | 'remap' | 'setScope' | 'removeFact' | 'setText'

export type AiPatchSource =
  | { kind: 'cell'; cell: CellRef }
  | { kind: 'identity'; terms: { factKey: string; weight: 1 | -1 }[] }
  | { kind: 'user' }

/** A patch as the agent proposes it (the wire shape of /fix/propose; same as the engine's FixPatch). */
export interface AiPatch {
  op: AiPatchOp
  fact?: { key?: string; concept: string; scope: 'CY' | 'PY' }
  cell?: CellRef
  from?: string | null
  to?: string
  value?: string | null
  source?: AiPatchSource
  rationale?: string
  confidence?: number
}

export type AiCardStatus = 'proposed' | 'accepted' | 'rejected' | 'failed'

/** A patch that passed the engine's check, as the AI panel shows it (diff card). */
export interface AiPatchCard {
  /** `${proposalId}:${index}` */
  id: string
  proposalId: string
  patch: AiPatch
  status: AiCardStatus
  /** e.g. "Set Share capital (current year)" */
  title: string
  before: string | null
  after: string | null
  /** where the value comes from: "Excel BS!C9", "= Share capital + Reserves and surplus", "you type it" */
  sourceLabel: string | null
  /** the user must type the value (source "user") */
  needsInput: boolean
  /** the user must confirm explicitly: removeFact, any value the user has to supply */
  needsConfirm: boolean
  /** dry run on a copy of the filing: true = its problem clears; null = not known (MCA errors, input needed) */
  resolves: boolean | null
  /** links */
  factKey: string | null
  cell: CellRef | null
  elrUri: string | null
  rationale: string
  confidence: number | null
  /** why applying failed, or the user's reject reason */
  note?: string
  decidedAt?: string
}

export interface AiDroppedPatch {
  patch: unknown
  /** "sidecar: …" (unreadable / not in the bundle) or "engine: …" (refused by the engine's check) */
  reason: string
}

export interface AiProposal {
  id: string
  problemId: string
  problemMessage: string
  /** Fix all round, null for a single Ask AI */
  round: number | null
  at: string
  summary: string
  needsHuman: boolean
  cards: AiPatchCard[]
  dropped: AiDroppedPatch[]
  model: string | null
  steps: number
  tokens: number
  durationMs: number
  error?: string
}

export type AiStopReason =
  | 'clean'
  | 'max-rounds'
  | 'nothing-accepted'
  | 'no-proposals'
  | 'budget-tokens'
  | 'budget-time'
  | 'stopped'
  | 'error'

export interface AiRun {
  mode: 'single' | 'fix-all'
  state: 'idle' | 'proposing' | 'reviewing' | 'done'
  round: number
  maxRounds: number
  perRound: number
  tokens: number
  tokenBudget: number
  elapsedMs: number
  timeBudgetMs: number
  stopReason: AiStopReason | null
  /** shown next to the stop reason, e.g. "3 accepted in round 2" */
  message: string | null
}

export type AiUnavailable = 'no-project' | 'no-consent' | 'no-key' | 'sidecar' | 'fixture'

export interface AiStatus {
  enabled: boolean
  reason: AiUnavailable | null
  message: string | null
  model: string | null
}

export interface AiView {
  revision: number
  status: AiStatus
  run: AiRun
  proposals: AiProposal[]
}

/** One line of ai/history.jsonl (the audit trail, kept in the project). */
export interface AiHistoryEntry {
  at: string
  /** the Windows user who made the decision or sent the request */
  by: string
  type: 'request' | 'response' | 'accept' | 'reject' | 'failed' | 'error' | 'run'
  proposalId?: string
  problemId?: string
  cardId?: string
  /** request: the exact payload sent to the AI (already without identity data) */
  payload?: unknown
  [k: string]: unknown
}

export const AI_STOP_TEXT: Record<AiStopReason, string> = {
  clean: 'no errors left',
  'max-rounds': 'round limit reached',
  'nothing-accepted': 'nothing was accepted in the last round',
  'no-proposals': 'the AI had nothing to propose',
  'budget-tokens': 'token budget used up',
  'budget-time': 'time budget used up',
  stopped: 'stopped by you',
  error: 'the AI service failed',
}

/** Problems the AI may look at: no document-level identity checks, no identity elements. */
export function aiEligible(p: Problem): boolean {
  if (p.code.startsWith('cin.') || p.code === 'schemaRef') return false
  const concept = p.location?.concept
  return !(concept && isIdentityElement(concept))
}
