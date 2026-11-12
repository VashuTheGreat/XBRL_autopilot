import { taxonomyLabel } from '@xap/engine/basics'
import { cn } from '@/lib/cn'
import { useProject } from '@/stores/project'
import { useSidecar } from '@/stores/sidecar'
import { useUi } from '@/stores/ui'
import { useValidation } from '@/stores/validation'

export function StatusBar() {
  const { status, app } = useSidecar()
  const filing = useProject((s) => s.summary)
  const problems = useValidation((s) => s.view?.summary ?? null)
  const openProblems = useUi((s) => s.setBottomTab)
  const dot =
    status.state === 'ready' ? 'bg-ok' : status.state === 'starting' ? 'bg-warn animate-pulse' : 'bg-err'
  const label =
    status.state === 'ready'
      ? `AI engine ready (v${status.version})`
      : status.state === 'starting'
        ? 'AI engine starting…'
        : status.state === 'error'
          ? 'AI engine error'
          : 'AI engine stopped'
  const ai =
    status.state === 'ready' ? (status.aiEnabled ? `Groq · ${status.model}` : 'AI off (no Groq key)') : null

  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-panel-2 px-3 text-[11px] text-muted">
      {filing ? (
        <>
          <span className="font-mono">{filing.company.cin}</span>
          <span>{filing.fyLabel}</span>
          <span>{filing.reportType}</span>
          <span data-testid="filing-taxonomy">{taxonomyLabel(filing.taxonomy)}</span>
          <span className={filing.dirty ? 'text-warn' : ''} data-testid="save-state">
            {filing.readOnlyReason ? 'Read-only' : filing.dirty ? (filing.path ? 'Unsaved changes' : 'Not saved yet') : 'Saved'}
          </span>
          {problems && (
            <button className="flex items-center gap-2 hover:text-fg" onClick={() => openProblems('problems')} title="Problems (live validation)" data-testid="status-problems">
              <span className={problems.errors ? 'text-err' : ''}>{problems.errors} errors</span>
              <span className={problems.warnings ? 'text-warn' : ''}>{problems.warnings} warnings</span>
            </button>
          )}
        </>
      ) : (
        <span>No filing open</span>
      )}
      <div className="flex-1" />
      <span
        className="flex items-center gap-1.5"
        title={status.state === 'error' ? status.message : undefined}
        data-testid="sidecar-status"
        data-state={status.state}
      >
        <span className={cn('h-2 w-2 rounded-full', dot)} />
        {label}
      </span>
      {ai && <span>{ai}</span>}
      {app && <span>v{app.version}{app.isDev ? ' · dev' : ''}</span>}
    </footer>
  )
}
