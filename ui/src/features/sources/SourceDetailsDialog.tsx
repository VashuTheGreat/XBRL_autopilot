import { FileSpreadsheet, MessageSquareText, X } from 'lucide-react'
import { formatIndian } from '@xap/engine/basics'
import { Button, Dialog } from '@/components/ui/primitives'
import { useEditor } from '@/stores/editor'
import { useSources } from '@/stores/sources'

/**
 * View details (docs/14 Step 3): every source of a tag with its signed amount and the filed total. A source can be
 * removed (the last one untags), and the make-up can be saved as a footnote on the fact.
 */
export function SourceDetailsDialog() {
  const { details: d, closeDetails, removeSource, saveFootnote } = useSources()
  const revealCell = useEditor((s) => s.revealCell)
  return (
    <Dialog
      open={!!d}
      onClose={closeDetails}
      title={d ? `${d.conceptLabel} (${d.scope})` : 'Details'}
      width={520}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => void saveFootnote()} disabled={!d?.factKey} title="Attach this make-up to the fact as an XBRL footnote" data-testid="details-footnote">
            <MessageSquareText size={14} /> Save as footnote ({d?.scope})
          </Button>
          <Button onClick={closeDetails}>Close</Button>
        </div>
      }
    >
      {d && (
        <table className="w-full text-xs" data-testid="source-details">
          <thead className="text-[11px] text-muted">
            <tr>
              <th className="py-1 text-left font-medium">Source</th>
              <th className="py-1 text-right font-medium">Amount</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {d.sources.map((s, i) => (
              <tr key={`${s.cell.workbook}|${s.cell.sheet}|${s.cell.ref}`} className="border-t border-border/50" data-testid="source-row">
                <td className="py-1">
                  <button className="flex items-center gap-1 font-mono hover:underline" onClick={() => revealCell(s.cell)} title="Show in Excel">
                    <FileSpreadsheet size={11} /> {s.cell.sheet}!{s.cell.ref}
                  </button>
                  {s.problem && <div className="text-[11px] text-err">{s.problem}</div>}
                </td>
                <td className="tabular py-1 text-right">{s.value === null ? '—' : formatIndian(s.value)}</td>
                <td className="py-1 text-right">
                  <button
                    className="text-muted hover:text-err"
                    onClick={() => void removeSource(i)}
                    title={d.sources.length === 1 ? 'Remove the only source (untags the line)' : 'Remove this source from the sum'}
                    data-testid="remove-source"
                  >
                    <X size={13} />
                  </button>
                </td>
              </tr>
            ))}
            <tr className="border-t border-border font-semibold">
              <td className="py-1">Total filed</td>
              <td className="tabular py-1 text-right" data-testid="details-total">
                {d.total === null ? '—' : formatIndian(d.total)}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      )}
    </Dialog>
  )
}
