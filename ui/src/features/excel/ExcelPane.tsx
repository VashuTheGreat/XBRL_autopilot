import { CheckCheck, FileSpreadsheet, Loader2, Sparkles, Upload } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { EmptyState } from '@/components/EmptyState'
import { Button } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { useEditor } from '@/stores/editor'
import { MappingInspector } from './MappingInspector'

// Univer is large: load it only when a workbook is shown, keeping app start-up fast.
const UniverGrid = lazy(() => import('./UniverGrid').then((m) => ({ default: m.UniverGrid })))

/** Left editor: the source workbook(s) with the tag overlay, and the inspector for the selected cell. */
export function ExcelPane() {
  const { workbooks, activeSource, setActiveSource, importWorkbook, busy } = useEditor()
  const active = workbooks.find((w) => w.source === activeSource) ?? workbooks[0] ?? null

  return (
    <section className="flex h-full flex-col bg-panel" aria-label="Excel workbook">
      <div className="flex h-8 shrink-0 items-stretch border-b border-border bg-panel-2 text-xs">
        <span className="flex items-center gap-2 px-3 text-muted">
          <FileSpreadsheet size={14} /> Excel
        </span>
        {workbooks.map((w) => (
          <button
            key={w.source}
            onClick={() => setActiveSource(w.source)}
            title={w.fileName}
            className={cn('max-w-48 truncate border-l border-border px-3 text-muted hover:text-fg', w.source === active?.source && 'bg-panel text-fg')}
          >
            {w.fileName}
          </button>
        ))}
        <div className="flex-1" />
        {workbooks.length > 0 && <AutoTagButtons />}
        {workbooks.length > 0 && (
          <button className="flex items-center gap-1 px-3 text-muted hover:text-fg" onClick={() => void importWorkbook()} title="Import another workbook">
            <Upload size={12} /> Import
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {active ? (
          <Suspense fallback={<EmptyState icon={FileSpreadsheet} title="Loading workbook…" />}>
            <UniverGrid key={active.source} model={active} />
          </Suspense>
        ) : (
          <EmptyState icon={FileSpreadsheet} title="No workbook imported">
            <p>Import the company&apos;s Excel financial statements (.xlsx or .xls). Tagged cells are coloured: green = approved, amber = AI suggestion.</p>
            <div className="mt-3">
              <Button variant="primary" disabled={busy} onClick={() => void importWorkbook()}>
                <Upload size={14} /> Import Excel…
              </Button>
            </div>
          </EmptyState>
        )}
      </div>
      {active && <MappingInspector />}
    </section>
  )
}

const ACCEPT_ALL_MIN = 0.9

/** "Auto-tag" (suggest tags for every imported workbook) and "Accept all ≥ 90%" once there are suggestions. */
function AutoTagButtons() {
  const { autoTag, autoTagging, acceptAllSuggestions, mappings } = useEditor()
  const open = mappings.filter((m) => m.status === 'suggested')
  const sure = open.filter((m) => (m.confidence ?? 0) >= ACCEPT_ALL_MIN).length
  return (
    <>
      {sure > 0 && (
        <button
          className="flex shrink-0 items-center gap-1 whitespace-nowrap border-l border-border px-3 text-muted hover:text-fg"
          onClick={() => void acceptAllSuggestions(ACCEPT_ALL_MIN)}
          title={`Tag the ${sure} suggested cells with confidence of 90% or more (${open.length} suggested in all)`}
          data-testid="accept-all"
        >
          <CheckCheck size={12} /> Accept all ≥ 90% ({sure})
        </button>
      )}
      <button
        className="flex shrink-0 items-center gap-1 whitespace-nowrap border-l border-border px-3 text-muted hover:text-fg disabled:opacity-50"
        onClick={() => void autoTag()}
        disabled={autoTagging}
        title="Suggest a taxonomy element for every figure of the statements and notes. Nothing is tagged until you accept."
        data-testid="auto-tag"
      >
        {autoTagging ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {autoTagging ? 'Auto-tagging…' : 'Auto-tag'}
      </button>
    </>
  )
}
