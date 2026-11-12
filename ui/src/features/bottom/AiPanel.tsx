import { ArrowRight, Check, ChevronDown, ChevronRight, CircleSlash, ExternalLink, History, Loader2, Pencil, Sparkles, Square, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { AI_STOP_TEXT, type AiHistoryEntry, type AiPatchCard, type AiProposal } from '@shared/ai'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { openCards, useAi } from '@/stores/ai'
import { useProject } from '@/stores/project'

const pct = (n: number | null) => (n == null ? null : `${Math.round(n * 100)}%`)

function DiffCard({ card }: { card: AiPatchCard }) {
  const { accept, reject, locate } = useAi()
  const typed = card.patch.source?.kind === 'user' || card.patch.op === 'setText'
  const [editing, setEditing] = useState(card.needsInput)
  const [input, setInput] = useState(card.after ?? card.patch.value ?? '')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const open = card.status === 'proposed'
  const canAccept = open && !busy && (!card.needsConfirm || confirmed) && (!editing || input.trim() !== '') && (!card.needsInput || input.trim() !== '')
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      className={cn('rounded border border-border bg-panel p-2', !open && 'opacity-70')}
      data-testid="ai-card"
      data-card-id={card.id}
      data-status={card.status}
      data-op={card.patch.op}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-fg">{card.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[11px]" data-testid="ai-diff">
            <span className={cn('rounded px-1', card.before == null ? 'text-muted' : 'bg-err/10 text-err line-through')}>{card.before ?? '(empty)'}</span>
            <ArrowRight size={11} className="text-muted" />
            <span className={cn('rounded px-1', card.after == null ? 'text-muted' : 'bg-ok/10 text-ok')}>{card.after ?? (card.patch.op === 'removeFact' ? '(removed)' : '(you type it)')}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
            {card.sourceLabel && <span data-testid="ai-source">from {card.sourceLabel}</span>}
            {pct(card.confidence) && <span>confidence {pct(card.confidence)}</span>}
            {card.resolves === true && <span className="text-ok" data-testid="ai-resolves">clears the problem (checked on a copy)</span>}
            {card.resolves === false && <span className="text-warn">does not clear the problem by itself</span>}
          </div>
          {card.rationale && <div className="mt-1 text-[11px] text-fg/80 select-text">{card.rationale}</div>}
          {card.note && <div className="mt-1 text-[11px] text-warn select-text">{card.note}</div>}
        </div>
        <button className="text-muted hover:text-fg" title="Show the cell and the fact" onClick={() => void locate(card)}>
          <ExternalLink size={12} />
        </button>
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {editing && (
            <input
              className="h-6 w-40 rounded border border-border bg-bg px-1.5 font-mono text-[11px] outline-none focus:border-accent select-text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={card.patch.op === 'setValue' ? 'amount as presented' : 'value'}
              data-testid="ai-input"
            />
          )}
          {card.needsConfirm && (
            <label className="flex items-center gap-1 text-[11px] text-muted">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="ai-confirm" />
              {card.patch.op === 'removeFact' ? 'Yes, remove it' : 'I checked this value'}
            </label>
          )}
          <div className="flex-1" />
          {typed && !card.needsInput && !editing && (
            <Button variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setEditing(true)} data-testid="ai-edit">
              <Pencil size={11} /> Edit
            </Button>
          )}
          <Button variant="ghost" className="h-6 px-2 text-[11px]" disabled={busy} onClick={() => void run(() => reject(card))} data-testid="ai-reject">
            <X size={11} /> Reject
          </Button>
          <Button
            variant="primary"
            className="h-6 px-2 text-[11px]"
            disabled={!canAccept}
            onClick={() => void run(() => accept(card, { ...(editing ? { input: input.trim() } : {}), confirmed }))}
            data-testid="ai-accept"
          >
            <Check size={11} /> Accept
          </Button>
        </div>
      )}
    </div>
  )
}

function ProposalBlock({ p }: { p: AiProposal }) {
  const [showDropped, setShowDropped] = useState(false)
  return (
    <div className="border-b border-border/60 px-3 py-2" data-testid="ai-proposal" data-proposal-id={p.id}>
      <div className="flex items-start gap-2 text-[11px]">
        <Sparkles size={12} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-muted" title={p.problemMessage}>
            {p.round != null && <span className="mr-1 rounded bg-panel-2 px-1">round {p.round}</span>}
            {p.problemMessage}
          </div>
          {p.summary && <div className="mt-0.5 text-fg select-text" data-testid="ai-summary">{p.summary}</div>}
          {p.error && <div className="mt-0.5 text-err select-text" data-testid="ai-error">{p.error}</div>}
          <div className="mt-0.5 text-[10px] text-muted">
            {p.model ?? 'AI'} · {p.steps} step(s) · {p.tokens.toLocaleString()} tokens · {(p.durationMs / 1000).toFixed(1)} s
            {p.needsHuman && <span className="ml-2 text-warn">needs your judgement</span>}
          </div>
        </div>
      </div>
      <div className="mt-2 space-y-2 pl-5">
        {p.cards.map((c) => (
          <DiffCard key={c.id} card={c} />
        ))}
        {!p.error && p.cards.length === 0 && <div className="text-[11px] text-muted">No patch could be shown for this problem.</div>}
        {p.dropped.length > 0 && (
          <div className="text-[11px] text-muted">
            <button className="flex items-center gap-1 hover:text-fg" onClick={() => setShowDropped(!showDropped)} data-testid="ai-dropped-toggle">
              {showDropped ? <ChevronDown size={11} /> : <ChevronRight size={11} />} {p.dropped.length} proposal(s) dropped by the checks
            </button>
            {showDropped && (
              <ul className="mt-1 list-disc pl-5 select-text" data-testid="ai-dropped">
                {p.dropped.map((d, i) => (
                  <li key={i}>{d.reason}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function HistoryList({ entries }: { entries: AiHistoryEntry[] }) {
  const [open, setOpen] = useState<number | null>(null)
  if (!entries.length) return <div className="p-3 text-[11px] text-muted">Nothing was sent to the AI for this filing yet.</div>
  return (
    <div className="px-3 py-2 text-[11px]" data-testid="ai-history">
      <div className="mb-1 text-muted">ai/history.jsonl — everything sent to the AI (exactly as sent), what came back, and every decision.</div>
      {[...entries].reverse().map((e, i) => (
        <div key={i} className="border-b border-border/40 py-1" data-testid="ai-history-entry" data-type={e.type}>
          <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen(open === i ? null : i)}>
            {open === i ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <span className="font-mono text-muted">{new Date(e.at).toLocaleString()}</span>
            <span className="rounded bg-panel-2 px-1">{e.type}</span>
            <span className="text-muted">{e.by}</span>
            {typeof e.op === 'string' && <span>{e.op}</span>}
          </button>
          {open === i && (
            <pre className="mt-1 max-h-64 overflow-auto rounded bg-bg p-2 font-mono text-[10px] select-text" data-testid="ai-history-payload">
              {JSON.stringify(e.payload ?? e, null, 2)}
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}

export function AiPanel() {
  const hasProject = useProject((s) => s.summary !== null)
  const { view, fixAll, stop, clear, history, historyOpen, toggleHistory } = useAi()
  if (!hasProject) {
    return (
      <EmptyState icon={Sparkles} title="No filing open">
        Proposed fixes appear here as reviewable patches. Nothing is changed until you accept.
      </EmptyState>
    )
  }
  const status = view?.status
  const run = view?.run
  const working = run?.state === 'proposing'
  const active = working || run?.state === 'reviewing'
  const pending = openCards(view ?? null).length
  return (
    <div className="flex h-full flex-col text-xs" data-testid="ai-panel">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2">
        <span className="flex items-center gap-1 text-[11px] text-muted" data-testid="ai-status">
          {status?.enabled ? <><Sparkles size={12} className="text-accent" /> {status.model}</> : <><CircleSlash size={12} /> AI off</>}
        </span>
        {run && run.state !== 'idle' && (
          <span className="text-[11px] text-muted" data-testid="ai-run" data-state={run.state} data-stop={run.stopReason ?? ''}>
            {working && <Loader2 size={11} className="mr-1 inline animate-spin" />}
            {run.mode === 'fix-all' ? `Fix all · round ${run.round}/${run.maxRounds} · ` : ''}
            {run.tokens.toLocaleString()}{run.mode === 'fix-all' ? ` / ${run.tokenBudget.toLocaleString()}` : ''} tokens
            {run.state === 'reviewing' && ` · ${pending} to review`}
            {run.state === 'done' && run.stopReason && ` · stopped: ${AI_STOP_TEXT[run.stopReason]}`}
            {run.state === 'done' && !run.stopReason && run.message && ` · ${run.message}`}
          </span>
        )}
        <div className="flex-1" />
        {active ? (
          <Button variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => void stop()} data-testid="ai-stop">
            <Square size={11} /> Stop
          </Button>
        ) : (
          <Button variant="secondary" className="h-6 px-2 text-[11px]" disabled={!status?.enabled} onClick={() => void fixAll()} title="Ask the AI about the errors, round by round (you review every patch)" data-testid="ai-fix-all">
            <Sparkles size={11} /> Fix all with AI
          </Button>
        )}
        <Button variant="ghost" className="h-6 px-2 text-[11px]" disabled={!view?.proposals.length || working} onClick={() => void clear()} title="Remove decided proposals">
          <Trash2 size={11} /> Clear
        </Button>
        <Button variant={historyOpen ? 'secondary' : 'ghost'} className="h-6 px-2 text-[11px]" onClick={() => void toggleHistory()} title="What was sent to the AI, and every decision" data-testid="ai-history-toggle">
          <History size={11} /> History
        </Button>
      </div>
      {status && !status.enabled && (
        <div className="border-b border-border bg-panel-2 px-3 py-1.5 text-[11px] text-muted" data-testid="ai-off" data-reason={status.reason ?? ''}>
          {status.message} Deterministic fixes in Problems still work.
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {historyOpen ? (
          <HistoryList entries={history ?? []} />
        ) : view?.proposals.length ? (
          [...view.proposals].reverse().map((p) => <ProposalBlock key={p.id} p={p} />)
        ) : (
          <EmptyState icon={Sparkles} title={working ? 'Asking the AI…' : 'No proposals yet'}>
            Use the ✦ button on a problem (Ask AI) or “Fix all with AI”. Every patch is checked by the engine and applied only when you accept it.
          </EmptyState>
        )}
      </div>
    </div>
  )
}
