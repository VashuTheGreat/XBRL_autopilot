import { FileSpreadsheet, FileText, Upload, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useNotes } from '@/stores/notes'

/**
 * A Word document as a notes view (docs/14 Step 6): its blocks — paragraphs, headings, lists, tables — converted to the
 * MCA subset. Click a block (Ctrl / Shift + click for more), then double-click an element in the Taxonomy panel to tag
 * them as that text block. The block HTML comes from the engine's sanitiser (only MCA-safe tags, no attributes but
 * class), so it is shown as is.
 */
export function DocumentPane() {
  const { documents, activeDoc, selected, showDoc, closeDoc, selectBlock, openDocx } = useNotes()
  const doc = documents.find((d) => d.id === activeDoc) ?? null
  return (
    <section className="flex h-full flex-col bg-panel" aria-label="Word document">
      <div className="flex h-8 shrink-0 items-stretch border-b border-border bg-panel-2 text-xs">
        <button className="flex items-center gap-2 px-3 text-muted hover:text-fg" onClick={() => showDoc(null)} title="Back to the Excel workbook">
          <FileSpreadsheet size={14} /> Excel
        </button>
        {documents.map((d) => (
          <span key={d.id} className={cn('flex max-w-56 items-center border-l border-border', d.id === activeDoc && 'bg-panel text-fg')}>
            <button className="flex min-w-0 items-center gap-1.5 truncate px-3 text-muted hover:text-fg" onClick={() => showDoc(d.id)} title={d.fileName}>
              <FileText size={12} /> <span className="truncate">{d.fileName}</span>
            </button>
            <button className="px-1 text-muted hover:text-fg" onClick={() => closeDoc(d.id)} aria-label={`Close ${d.fileName}`}>
              <X size={11} />
            </button>
          </span>
        ))}
        <div className="flex-1" />
        <button className="flex items-center gap-1 px-3 text-muted hover:text-fg" onClick={() => void openDocx()} title="Open another Word document">
          <Upload size={12} /> Open Word
        </button>
      </div>
      <p className="shrink-0 border-b border-border px-3 py-1 text-[11px] text-muted">
        {selected.length ? `${selected.length} block(s) selected — double-click a text block in the Taxonomy panel to tag them.` : 'Click a block (Ctrl / Shift + click for more), then double-click a text block in the Taxonomy panel.'}
      </p>
      <div className="min-h-0 flex-1 overflow-auto p-3" data-testid="document-pane">
        {doc?.blocks.map((html, i) => (
          <div
            key={i}
            role="button"
            tabIndex={0}
            aria-pressed={selected.includes(i)}
            data-testid="document-block"
            className={cn(
              'note-block mb-1 cursor-pointer rounded border border-transparent px-2 py-1 text-[13px] leading-relaxed hover:border-border [&_h5]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-1.5 [&_ul]:list-disc [&_ul]:pl-6',
              selected.includes(i) && 'border-accent bg-accent/10',
            )}
            onClick={(e) => selectBlock(i, e.ctrlKey || e.metaKey || e.shiftKey)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && selectBlock(i, e.ctrlKey || e.shiftKey)}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ))}
      </div>
    </section>
  )
}
