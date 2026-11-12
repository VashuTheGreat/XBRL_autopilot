import { ChevronDown, ChevronRight, CircleAlert, ExternalLink, Info, ListChecks, RefreshCw, Sparkles, TriangleAlert, Upload, Wrench, X } from 'lucide-react'
import { useState } from 'react'
import { aiEligible } from '@shared/ai'
import type { Problem, ProblemSeverity } from '@shared/validation'
import { EmptyState } from '@/components/EmptyState'
import { Button, Dialog } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { useAi } from '@/stores/ai'
import { useProject } from '@/stores/project'
import { groupByStatement, useValidation, visibleProblems, type SourceFilter } from '@/stores/validation'

const ICON = { error: CircleAlert, warning: TriangleAlert, info: Info } as const
const TONE = { error: 'text-err', warning: 'text-warn', info: 'text-muted' } as const

function SeverityToggle({ s, count }: { s: ProblemSeverity; count: number }) {
  const on = useValidation((st) => st.severities[s])
  const toggle = useValidation((st) => st.toggleSeverity)
  const Icon = ICON[s]
  return (
    <button
      className={cn('flex items-center gap-1 rounded px-1.5 py-0.5', on ? 'bg-panel-2 text-fg' : 'text-muted opacity-60')}
      onClick={() => toggle(s)}
      title={`${on ? 'Hide' : 'Show'} ${s}s`}
      data-testid={`problems-filter-${s}`}
    >
      <Icon size={12} className={TONE[s]} /> {count}
    </button>
  )
}

function ProblemRow({ p }: { p: Problem }) {
  const { selected, locate, fix, select } = useValidation()
  const ai = useAi((s) => s.view)
  const ask = useAi((s) => s.ask)
  const [open, setOpen] = useState(false)
  const aiReady = !!ai?.status.enabled && ai.run.state !== 'proposing'
  const aiTitle = !aiEligible(p)
    ? 'Identity data is never sent to the AI'
    : !ai?.status.enabled
      ? ai?.status.message ?? 'AI is off'
      : ai.run.state === 'proposing'
        ? 'The AI is working on another request'
        : 'Ask AI: propose a fix you can review'
  const Icon = ICON[p.severity]
  return (
    <div
      className={cn('group border-b border-border/50 px-3 py-1 hover:bg-panel-2', selected === p.id && 'bg-panel-2')}
      onClick={() => select(p.id)}
      onDoubleClick={() => void locate(p)}
      data-testid="problem"
      data-problem-id={p.id}
      data-severity={p.severity}
      data-source={p.source}
    >
      <div className="flex items-start gap-2">
        {p.explanation ? (
          <button className="mt-0.5 text-muted" onClick={() => setOpen(!open)} title="Explain">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <Icon size={13} className={cn('mt-0.5 shrink-0', TONE[p.severity])} />
        )}
        <div className="min-w-0 flex-1 select-text">
          <span className="break-words">{p.message}</span>
          {p.cell && (
            <span className="ml-2 font-mono text-[10px] text-accent" data-testid="problem-cell">
              {p.cell.sheet}!{p.cell.ref}
            </span>
          )}
          {p.location?.scope && <span className="ml-2 text-[10px] text-muted">{p.location.scope}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1 opacity-70 group-hover:opacity-100">
          {(p.location?.elrUri || p.cell) && (
            <button className="text-muted hover:text-fg" title="Locate (double-click)" onClick={() => void locate(p)}>
              <ExternalLink size={12} />
            </button>
          )}
          {p.fix && (
            <Button variant="secondary" className="h-6 px-2 text-[11px]" onClick={() => void fix(p)} title={p.fix.label} data-testid="problem-fix">
              <Wrench size={11} /> Fix
            </Button>
          )}
          <button
            className={cn('text-muted', aiReady && aiEligible(p) ? 'hover:text-accent' : 'cursor-not-allowed opacity-40')}
            disabled={!aiReady || !aiEligible(p)}
            title={aiTitle}
            onClick={(e) => {
              e.stopPropagation()
              void ask(p)
            }}
            data-testid="problem-ask-ai"
          >
            <Sparkles size={12} />
          </button>
        </div>
      </div>
      {open && p.explanation && (
        <div className="mt-1 ml-5 space-y-0.5 text-[11px] text-muted select-text" data-testid="problem-explanation">
          <div className="text-fg">{p.explanation.title}</div>
          <div><b>Meaning:</b> {p.explanation.meaning}</div>
          <div><b>Likely cause:</b> {p.explanation.cause}</div>
          <div><b>Fix:</b> {p.explanation.fix}</div>
        </div>
      )}
    </div>
  )
}

function PasteMcaDialog() {
  const { pasteOpen, setPasteOpen, importMcaText, importMcaFile } = useValidation()
  const [text, setText] = useState('')
  return (
    <Dialog
      open={pasteOpen}
      title="Import MCA Validation Tool errors"
      onClose={() => setPasteOpen(false)}
      width={640}
      footer={
        <>
          <Button variant="ghost" onClick={() => void importMcaFile().then(() => setPasteOpen(false))}>Load from file…</Button>
          <div className="flex-1" />
          <Button onClick={() => setPasteOpen(false)}>Cancel</Button>
          <Button variant="primary" disabled={!text.trim()} onClick={() => void importMcaText(text).then((ok) => ok && setText(''))} data-testid="mca-import-submit">
            Import
          </Button>
        </>
      }
    >
      <p className="mb-2 text-xs text-muted">Paste the error list the MCA XBRL Validation Tool shows after Validate. Each line is explained and linked to its element.</p>
      <textarea
        className="h-64 w-full rounded border border-border bg-panel p-2 font-mono text-[11px] outline-none focus:border-accent select-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="1) cvc-datatype-valid.1.2.1: '' is not a valid value for 'decimal'."
        data-testid="mca-import-text"
      />
    </Dialog>
  )
}

export function ProblemsPanel() {
  const hasProject = useProject((s) => s.summary !== null)
  const { view, severities, source, setSource, run, setPasteOpen, launchMca, clearMca } = useValidation()
  const ai = useAi((s) => s.view)
  const fixAll = useAi((s) => s.fixAll)
  if (!hasProject) {
    return (
      <EmptyState icon={TriangleAlert} title="No filing open">
        Problems appear here as soon as a filing is open; they update after every change.
      </EmptyState>
    )
  }
  const shown = visibleProblems(view, severities, source)
  const groups = groupByStatement(shown)
  const c = view?.coverage
  return (
    <div className="flex h-full flex-col text-xs" data-testid="problems-panel">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2">
        <SeverityToggle s="error" count={view?.summary.errors ?? 0} />
        <SeverityToggle s="warning" count={view?.summary.warnings ?? 0} />
        <SeverityToggle s="info" count={view?.summary.info ?? 0} />
        <select
          className="h-6 rounded border border-border bg-panel px-1 text-[11px]"
          value={source}
          onChange={(e) => setSource(e.target.value as SourceFilter)}
          data-testid="problems-source"
        >
          <option value="all">All sources</option>
          <option value="engine">This app</option>
          <option value="mca">MCA tool{view?.mca ? ` (${view.mca.count})` : ''}</option>
        </select>
        {c && c.executableShare !== null && (
          <span className="flex items-center gap-1 text-[11px] text-muted" title={`${c.executable} executed · ${c.reviewOnly} review-only (MCA21 data) · ${c.unimplemented} not formalized · ${c.notApplicable} not applicable`} data-testid="rule-coverage">
            <ListChecks size={12} /> Rules {(c.executableShare * 100).toFixed(1)}% executable
          </span>
        )}
        <div className="flex-1" />
        <Button
          variant="ghost"
          className="h-6 px-2 text-[11px]"
          disabled={!ai?.status.enabled || ai.run.state === 'proposing' || ai.run.state === 'reviewing' || !(view?.summary.errors ?? 0)}
          onClick={() => void fixAll()}
          title={ai?.status.enabled ? 'Fix all with AI: rounds of up to 10 errors, each patch reviewed by you' : ai?.status.message ?? 'AI is off'}
          data-testid="problems-fix-all"
        >
          <Sparkles size={11} /> Fix all with AI
        </Button>
        <Button variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => void run()} title="Validate now" data-testid="problems-run">
          <RefreshCw size={11} /> Validate
        </Button>
        <Button variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => void launchMca()} title="Write the XML and open the MCA XBRL Validation Tool">
          <ExternalLink size={11} /> MCA tool
        </Button>
        <Button variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setPasteOpen(true)} data-testid="mca-import">
          <Upload size={11} /> Import MCA errors
        </Button>
        {view?.mca && (
          <button className="text-muted hover:text-fg" onClick={() => void clearMca()} title={`Remove the imported MCA error list (${view.mca.file})`}>
            <X size={12} />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto" data-testid="problems-list">
        {view && view.at === null && <div className="p-3 text-muted">Validating…</div>}
        {view && view.at !== null && shown.length === 0 && (
          <div className="p-3 text-muted">{view.problems.length ? 'No problems match the filters.' : 'No problems detected.'}</div>
        )}
        {groups.map((g) => (
          <div key={g.key}>
            <div className="sticky top-0 bg-panel px-3 py-1 text-[11px] font-medium text-muted">
              {g.title} <span className="opacity-70">({g.problems.length})</span>
            </div>
            {g.problems.slice(0, 500).map((p) => (
              <ProblemRow key={p.id} p={p} />
            ))}
          </div>
        ))}
      </div>
      <PasteMcaDialog />
    </div>
  )
}
