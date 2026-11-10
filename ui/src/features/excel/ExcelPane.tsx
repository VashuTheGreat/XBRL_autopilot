import { FileSpreadsheet } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'

/** Left editor: the source Excel workbook (Univer, Phase 4) with mapping-status colours. */
export function ExcelPane() {
  return (
    <section className="flex h-full flex-col bg-panel" aria-label="Excel workbook">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-panel-2 px-3 text-xs text-muted">
        <FileSpreadsheet size={14} /> Excel
      </div>
      <div className="min-h-0 flex-1">
        <EmptyState icon={FileSpreadsheet} title="No workbook loaded" phase="Phase 4">
          Import the company&apos;s Excel financial statements. Tagged cells are coloured: green = approved, amber = AI
          suggestion, red = has an error.
        </EmptyState>
      </div>
    </section>
  )
}
