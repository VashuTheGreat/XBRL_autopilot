import { Link2, Search, Unlink } from 'lucide-react'
import { formatIndian } from '@xap/engine/basics'
import type { Scope } from '@shared/editor'
import { cellKey, fromA1 } from '@shared/workbook'
import { Button } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { useEditor } from '@/stores/editor'
import { useUi } from '@/stores/ui'

/** Strip under the grid: what the selected cell is tagged as, with quick actions (docs/08-ui-ux.md). */
export function MappingInspector() {
  const { selection, byCell, workbooks, untag, setScope, selectFact } = useEditor()
  const setActivity = useUi((s) => s.setActivity)
  const cell = selection.cell
  if (!cell) {
    return <footer className="flex h-9 shrink-0 items-center border-t border-border px-3 text-[11px] text-muted">Select a cell to see or set its tag.</footer>
  }
  const at = fromA1(cell.ref)
  const raw = workbooks
    .find((w) => w.source === cell.workbook)
    ?.sheets.find((s) => s.name === cell.sheet)
    ?.cells.find((c) => at && c.r === at.r && c.c === at.c)?.v
  const m = byCell.get(cellKey(cell))

  return (
    <footer className="flex h-9 shrink-0 items-center gap-3 border-t border-border px-3 text-xs" data-testid="inspector">
      <span className="font-mono text-muted">
        {cell.sheet}!{cell.ref}
      </span>
      <span className="max-w-40 truncate tabular" title={raw == null ? '' : String(raw)}>
        {raw == null ? <span className="text-muted">empty</span> : typeof raw === 'number' ? formatIndian(String(raw)) : String(raw)}
      </span>
      <span className="h-4 w-px bg-border" />
      {m ? (
        <>
          <button className="flex min-w-0 items-center gap-1.5 hover:underline" title={m.fact.concept} onClick={() => selectFact(m.factKey)}>
            <Link2 size={13} className="shrink-0 text-ok" />
            <span className="truncate">{m.conceptLabel}</span>
          </button>
          <div className="flex overflow-hidden rounded border border-border" role="group" aria-label="Period">
            {(['CY', 'PY'] as Scope[]).map((s) => (
              <button
                key={s}
                onClick={() => void setScope(m.id, s)}
                className={cn('px-2 py-0.5 text-[11px]', m.fact.scope === s ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg')}
              >
                {s}
              </button>
            ))}
          </div>
          {m.sign === -1 && <span className="text-[11px] text-warn">sign reversed</span>}
          <div className="flex-1" />
          <Button variant="ghost" className="h-6 px-2" onClick={() => void untag(m.id)} title="Remove this tag">
            <Unlink size={13} /> Untag
          </Button>
        </>
      ) : (
        <>
          <span className="text-muted">Not tagged.</span>
          <Button variant="ghost" className="h-6 px-2" onClick={() => setActivity('taxonomy')}>
            <Search size={13} /> Find an element…
          </Button>
        </>
      )}
    </footer>
  )
}
