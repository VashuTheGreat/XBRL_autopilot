import { FilePlus2, FolderOpen, History, LifeBuoy, Trash2, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { useProject } from '@/stores/project'

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function Card(props: { title: string; icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-md border border-border bg-panel', props.className)}>
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-xs font-semibold">
        {props.icon}
        {props.title}
      </header>
      <div className="p-2">{props.children}</div>
    </section>
  )
}

/** Shown when no filing is open: start, open, recent, recover. */
export function WelcomeScreen() {
  const { recent, recovery, openNewFiling, open, recover, discardRecovery, forgetRecent } = useProject()
  return (
    <div className="h-full overflow-auto bg-bg">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
        <div>
          <h1 className="text-xl font-semibold">XBRL Autopilot</h1>
          <p className="mt-1 text-sm text-muted">Prepare MCA AOC-4 XBRL filings from Excel — AI-assisted tagging, validation and fixes.</p>
        </div>

        <div className="flex gap-2">
          <Button variant="primary" onClick={openNewFiling}>
            <FilePlus2 size={15} /> New filing
          </Button>
          <Button onClick={() => void open()}>
            <FolderOpen size={15} /> Open…
          </Button>
        </div>

        {recovery.length > 0 && (
          <Card title="Recover unsaved work" icon={<LifeBuoy size={14} className="text-warn" />} className="border-warn/50">
            <ul>
              {recovery.map((r) => (
                <li key={r.id} className="flex items-center gap-3 rounded px-2 py-2 hover:bg-panel-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]">
                      {r.company} · {r.fy}
                    </div>
                    <div className="truncate text-[11px] text-muted">
                      Autosaved {when(r.savedAt)}
                      {r.originalPath ? ` · ${r.originalPath}` : ' · never saved'}
                    </div>
                  </div>
                  <Button variant="primary" onClick={() => void recover(r.id)}>
                    Recover
                  </Button>
                  <Button variant="ghost" title="Discard this copy" onClick={() => void discardRecovery(r.id)}>
                    <Trash2 size={14} />
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title="Recent filings" icon={<History size={14} className="text-muted" />}>
          {recent.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted">No recent filings. Create one to get started.</p>
          ) : (
            <ul>
              {recent.map((r) => (
                <li key={r.path} className="group flex items-center gap-3 rounded px-2 py-1.5 hover:bg-panel-2">
                  <button
                    className="min-w-0 flex-1 text-left disabled:opacity-50"
                    disabled={!r.exists}
                    title={r.exists ? r.path : 'File not found'}
                    onClick={() => void open(r.path)}
                  >
                    <div className="truncate text-[13px]">
                      {r.company} <span className="text-muted">· {r.fy}</span>
                    </div>
                    <div className="truncate text-[11px] text-muted">{r.exists ? r.path : `Missing: ${r.path}`}</div>
                  </button>
                  <span className="shrink-0 font-mono text-[11px] text-muted">{r.cin}</span>
                  <button
                    className="text-muted opacity-0 group-hover:opacity-100 hover:text-fg"
                    title="Remove from list"
                    onClick={() => void forgetRecent(r.path)}
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
