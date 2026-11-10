import { FileSpreadsheet, Table2 } from 'lucide-react'
import { useMemo } from 'react'
import { formatIndian } from '@xap/engine/basics'
import type { FormCell, FormRow } from '@shared/editor'
import { cellKey } from '@shared/workbook'
import { EmptyState } from '@/components/EmptyState'
import { Select } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { useEditor } from '@/stores/editor'
import { useProject } from '@/stores/project'

/** XBRL Form: one statement (ELR) with its CY/PY facts and the Excel cell each value came from. */
export function FormView() {
  const { form, activeElr, setActiveElr, selection, selectFact } = useEditor()
  const { elrs, summary } = useProject()
  const selectedCellKey = selection.cell ? cellKey(selection.cell) : null
  const hasPy = !summary?.firstFinancialYear

  const options = useMemo(() => elrs.map((e) => ({ uri: e.uri, label: `[${e.code}] ${e.title}` })), [elrs])

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <Select className="h-7 text-xs" value={activeElr ?? ''} onChange={(e) => void setActiveElr(e.target.value)} aria-label="Statement">
          {options.map((o) => (
            <option key={o.uri} value={o.uri}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
      {!form ? (
        <EmptyState icon={Table2} title="Loading statement…" />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-[12px]" data-testid="form-table">
            <thead className="sticky top-0 z-10 bg-panel-2 text-[11px] text-muted">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Particulars</th>
                <th className="w-36 px-3 py-1.5 text-right font-medium">Current year</th>
                {hasPy && <th className="w-36 px-3 py-1.5 text-right font-medium">Previous year</th>}
              </tr>
            </thead>
            <tbody>
              {form.rows.map((r, i) => (
                <Row key={`${r.concept ?? r.tableId ?? 'h'}-${i}`} row={r} hasPy={hasPy} selectedFact={selection.factKey} selectedCell={selectedCellKey} onPick={selectFact} />
              ))}
            </tbody>
          </table>
          {form.tableCount > 0 && (
            <p className="px-3 py-3 text-[11px] text-muted">
              Rows marked “in table” are reported inside one of this statement’s {form.tableCount} dimensional table(s); tagging tables is part of a later phase.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Row(props: { row: FormRow; hasPy: boolean; selectedFact: string | null; selectedCell: string | null; onPick(factKey: string | null): void }) {
  const { row: r } = props
  const indent = { paddingLeft: `${0.75 + r.depth * 0.9}rem` }
  if (r.kind !== 'item') {
    return (
      <tr className="border-b border-border/50">
        <td colSpan={props.hasPy ? 3 : 2} style={indent} className={cn('py-1 pr-3', r.kind === 'header' ? 'font-semibold' : 'italic text-muted')}>
          {r.kind === 'table' && <Table2 size={11} className="mr-1 inline" />}
          {r.label}
        </td>
      </tr>
    )
  }
  if (r.dimensional) {
    return (
      <tr className="border-b border-border/50 text-muted">
        <td style={indent} className="py-1 pr-3" title={r.concept}>
          {r.label}
        </td>
        <td colSpan={props.hasPy ? 2 : 1} className="px-3 py-1 text-right text-[10px] italic">
          in table
        </td>
      </tr>
    )
  }
  const active = [r.cy, r.py].some((c) => c?.factKey && c.factKey === props.selectedFact)
  return (
    <tr className={cn('border-b border-border/50 hover:bg-panel-2', active && 'bg-accent/10')}>
      <td style={indent} className="py-1 pr-3" title={r.concept}>
        {r.label}
      </td>
      <ValueCell cell={r.cy} {...props} />
      {props.hasPy && <ValueCell cell={r.py} {...props} />}
    </tr>
  )
}

function ValueCell(props: { cell: FormCell | undefined; selectedFact: string | null; selectedCell: string | null; onPick(factKey: string | null): void }) {
  const c = props.cell
  if (!c) return <td />
  const selected = !!c.factKey && c.factKey === props.selectedFact
  return (
    <td className="px-3 py-1 text-right">
      <button
        disabled={!c.factKey}
        onClick={() => props.onPick(c.factKey)}
        className={cn('tabular inline-flex items-center gap-1.5 rounded px-1 disabled:cursor-default', selected && 'outline outline-1 outline-accent', c.factKey && 'hover:bg-panel')}
      >
        {c.source && (
          <span className={cn('flex items-center gap-0.5 rounded bg-ok/15 px-1 font-mono text-[10px] text-ok', props.selectedCell === cellKey(c.source) && 'bg-accent/20 text-accent')} title={`From ${c.source.sheet}!${c.source.ref}`}>
            <FileSpreadsheet size={9} />
            {c.source.ref}
          </span>
        )}
        <span>{formatIndian(c.display)}</span>
      </button>
    </td>
  )
}
