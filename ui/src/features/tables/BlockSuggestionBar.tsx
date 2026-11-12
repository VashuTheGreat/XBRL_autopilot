/**
 * A suggested table block (ADR-0013) under the selected cell: which taxonomy table auto-tagging matched the range to,
 * how sure it is, and Accept (tag the cells as suggested), Review… ("Map as table", prefilled) or Reject.
 */
import { Check, Pencil, Table2, X } from 'lucide-react'
import { overlaps } from '@shared/workbook'
import { Button } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { useEditor } from '@/stores/editor'
import { useTables } from '@/stores/tables'

export function BlockSuggestionBar() {
  const cell = useEditor((s) => s.selection.cell)
  const blocks = useEditor((s) => s.blockSuggestions)
  const { acceptBlock, rejectBlock, open } = useTables()
  const b = cell ? blocks.find((x) => x.status === 'suggested' && overlaps(x.cell, cell)) : undefined
  if (!b) return null
  const pct = Math.round(b.confidence * 100)
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-t border-dashed border-warn/60 bg-warn/5 px-3 text-xs" data-testid="block-suggestion" data-range={b.cell.ref}>
      <Table2 size={13} className="shrink-0 text-warn" />
      <span className="min-w-16 flex-1 truncate" title={`Suggested table: ${b.tableTitle} (${b.tableId})`}>
        {b.tableTitle}
      </span>
      <span className={cn('shrink-0 rounded px-1 text-[10px]', pct >= 90 ? 'bg-ok/15 text-ok' : pct >= 60 ? 'bg-warn/15 text-warn' : 'bg-err/15 text-err')} data-testid="block-confidence">
        {pct}%
      </span>
      <span className="min-w-0 truncate text-[11px] text-muted">
        {b.cell.ref} · {b.cellCount} cells
      </span>
      <Button variant="primary" className="h-6 shrink-0 px-2" onClick={() => void acceptBlock(b.id)} title="Tag the block’s cells as suggested" data-testid="block-accept">
        <Check size={13} /> Accept
      </Button>
      <Button variant="ghost" className="h-6 shrink-0 px-2" onClick={() => open({ kind: 'map', range: b.cell, suggestion: b })} title="Open “Map as table” with this suggestion filled in" data-testid="block-review">
        <Pencil size={13} /> Review…
      </Button>
      <Button variant="ghost" className="h-6 shrink-0 px-2" onClick={() => void rejectBlock(b.id)} data-testid="block-reject">
        <X size={13} /> Reject
      </Button>
    </div>
  )
}
