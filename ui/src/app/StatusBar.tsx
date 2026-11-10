import { cn } from '@/lib/cn'
import { useSidecar } from '@/stores/sidecar'

export function StatusBar() {
  const { status, app } = useSidecar()
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
      <span>No filing open</span>
      <span>C&amp;I 2016</span>
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
