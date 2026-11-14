import { BookmarkPlus, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { panNameConcepts, recordTitle, type MasterGridView, type MasterRowView } from '@shared/masters'
import { Button } from '@/components/ui/primitives'
import { useMasters } from '@/stores/masters'
import { MasterFieldInput } from './MasterFieldInput'

/**
 * A master grid (auditors, directors signing, managers): one row per typed member, shown as a card that opens to edit
 * its fields (the side panel is too narrow for columns). Rows added here appear once a field has a value.
 */
export function MasterGrid(props: { grid: MasterGridView; onFillFromLibrary(): void }) {
  const { grid } = props
  const pending = useMasters((s) => s.pending[grid.tableId]) ?? []
  const addRow = useMasters((s) => s.addRow)
  const rows: MasterRowView[] = [...grid.rows, ...pending.filter((m) => !grid.rows.some((r) => r.member === m)).map((member) => ({ member, values: {} }))]
  return (
    <div className="flex flex-col gap-1" data-testid="master-grid" data-table={grid.tableId}>
      <div className="flex items-center gap-1">
        <span className="flex-1 text-[11px] font-medium">{grid.title}</span>
        <Button variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={props.onFillFromLibrary} title="Add rows from the master library">
          Fill from master
        </Button>
        <Button variant="ghost" className="h-6 px-1.5" onClick={() => void addRow(grid.tableId)} aria-label={`Add a row to ${grid.title}`} title="Add a row">
          <Plus size={12} />
        </Button>
      </div>
      {!rows.length && <p className="pl-1 text-[11px] text-muted">No rows yet.</p>}
      {rows.map((r, i) => (
        <GridRow key={r.member} grid={grid} row={r} initiallyOpen={!Object.keys(r.values).length || (rows.length === 1 && i === 0)} />
      ))}
    </div>
  )
}

/** The fields that name a row: the first free-text columns (a name, a DIN), not the lists. */
export const titleOrder = (grid: MasterGridView) => grid.columns.filter((c) => !c.options).map((c) => c.concept)

function GridRow(props: { grid: MasterGridView; row: MasterRowView; initiallyOpen: boolean }) {
  const { grid, row } = props
  const [open, setOpen] = useState(props.initiallyOpen)
  const { setCell, removeRow, save } = useMasters()
  const names = panNameConcepts(grid.panPairs)
  const saved = Object.keys(row.values).length > 0
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div className="rounded border border-border" data-testid="master-row" data-member={row.member}>
      <div className="flex items-center gap-1 px-1.5 py-1">
        <button type="button" className="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px]" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Chevron size={12} className="shrink-0" />
          <span className="truncate">{saved ? recordTitle(row.values, titleOrder(grid)) : 'New row'}</span>
          <span className="shrink-0 text-[10px] text-muted">{row.member}</span>
        </button>
        {saved && (
          <Button variant="ghost" className="h-5 px-1" onClick={() => void save({ tableId: grid.tableId, member: row.member })} title="Save to the master library (reuse it in other filings)" aria-label="Save to the master library">
            <BookmarkPlus size={12} />
          </Button>
        )}
        <Button variant="ghost" className="h-5 px-1" onClick={() => void removeRow({ tableId: grid.tableId, member: row.member })} title="Remove this row from the filing" aria-label="Remove row">
          <Trash2 size={12} />
        </Button>
      </div>
      {open && (
        <div className="flex flex-col gap-2 border-t border-border px-2 py-2">
          {grid.columns.map((c) => (
            <MasterFieldInput
              key={c.concept}
              field={c}
              values={row.values}
              pairs={grid.panPairs}
              panName={names.has(c.concept)}
              onWrite={(value) => void setCell({ tableId: grid.tableId, member: row.member, concept: c.concept, value })}
            />
          ))}
        </div>
      )}
    </div>
  )
}
