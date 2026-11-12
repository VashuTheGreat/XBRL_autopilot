import { CheckCheck, Columns3, FileSpreadsheet, Loader2, Sparkles, Table2, Upload } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { columnLetter, fromA1 } from '@shared/workbook'
import { EmptyState } from '@/components/EmptyState'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Button } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { useEditor } from '@/stores/editor'
import { useTables } from '@/stores/tables'
import { BlockSuggestionBar } from '@/features/tables/BlockSuggestionBar'
import { AutoTagColumnDialog } from './AutoTagColumnDialog'
import { MappingInspector } from './MappingInspector'
import { SheetColumnsDialog } from './SheetColumnsDialog'

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
        {workbooks.length > 0 && <SheetColumnsButton />}
        {workbooks.length > 0 && <MapAsTableButton />}
        {workbooks.length > 0 && <AutoTagButtons />}
        {workbooks.length > 0 && (
          <button className="flex items-center gap-1 px-3 text-muted hover:text-fg" onClick={() => void importWorkbook()} title="Import another workbook">
            <Upload size={12} /> Import
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {active ? (
          <ErrorBoundary key={active.source} what="The Excel view">
            <Suspense fallback={<EmptyState icon={FileSpreadsheet} title="Loading workbook…" />}>
              <UniverGrid model={active} />
            </Suspense>
          </ErrorBoundary>
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
      {active && <BlockSuggestionBar />}
      {active && <MappingInspector />}
    </section>
  )
}

/** Sheet column configuration button (CY / PY). */
function SheetColumnsButton() {
  const { sheetColumns, activeSource, workbooks, selection } = useEditor()
  const [dialogOpen, setDialogOpen] = useState(false)
  const activeWb = workbooks.find((w) => w.source === activeSource) ?? workbooks[0]
  const currentSheet = selection.cell?.sheet ?? activeWb?.sheets[0]?.name

  const cy = sheetColumns?.cyColumn
  const py = sheetColumns?.pyColumn

  return (
    <>
      <button
        className={cn(
          'flex shrink-0 items-center gap-1.5 whitespace-nowrap border-l border-border px-3 text-xs transition-colors',
          cy ? 'text-muted hover:text-fg' : 'bg-warn/10 text-warn font-medium hover:bg-warn/20',
        )}
        onClick={() => setDialogOpen(true)}
        title={
          cy
            ? `Columns for ${currentSheet ?? 'sheet'}: CY = Col ${cy}${py ? `, PY = Col ${py}` : ''}. Click to reconfigure.`
            : `No CY / PY columns set for ${currentSheet ?? 'this sheet'}. Click to configure figure columns.`
        }
        data-testid="sheet-columns-btn"
      >
        <Columns3 size={13} className={cy ? 'text-accent' : 'text-warn'} />
        {cy ? (
          <span>
            CY: <strong className="font-semibold text-fg">Col {cy}</strong>
            {py && (
              <>
                <span className="mx-1 opacity-40">·</span>
                PY: <strong className="font-semibold text-fg">Col {py}</strong>
              </>
            )}
          </span>
        ) : (
          <span>Set CY / PY Columns</span>
        )}
      </button>

      <SheetColumnsDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        workbookSource={activeWb?.source}
        sheetName={currentSheet}
      />
    </>
  )
}

/** "Map as table": enabled after dragging over a block of rows and columns (ADR-0013). */
function MapAsTableButton() {
  const blockRange = useEditor((s) => s.blockRange)
  const open = useTables((s) => s.open)
  return (
    <button
      className="flex shrink-0 items-center gap-1 whitespace-nowrap border-l border-border px-3 text-muted hover:text-fg disabled:opacity-40"
      disabled={!blockRange}
      onClick={() => blockRange && open({ kind: 'map', range: blockRange })}
      title={blockRange ? `Map ${blockRange.sheet}!${blockRange.ref} to a taxonomy table: rows → line items, columns → members and year` : 'Drag over a block of rows and columns (a note table) to map it to a taxonomy table'}
      data-testid="map-as-table"
    >
      <Table2 size={12} /> Map as table
    </button>
  )
}

const ACCEPT_ALL_MIN = 0.9

/** "Auto-tag" (suggest tags for user-specified column) and "Accept all ≥ 90%" once there are suggestions. */
function AutoTagButtons() {
  const { autoTagging, acceptAllSuggestions, mappings, blockSuggestions, selection, activeSource, workbooks } = useEditor()
  const [dialogOpen, setDialogOpen] = useState(false)
  const open = mappings.filter((m) => m.status === 'suggested')
  const sureBlocks = blockSuggestions.filter((b) => b.status === 'suggested' && b.confidence >= ACCEPT_ALL_MIN).length
  const sure = open.filter((m) => (m.confidence ?? 0) >= ACCEPT_ALL_MIN).length + sureBlocks

  const activeWb = workbooks.find((w) => w.source === activeSource) ?? workbooks[0]
  const defaultCol = selection.cell?.ref ? columnLetter(fromA1(selection.cell.ref)?.c ?? 1) : 'B'
  const sheetName = selection.cell?.sheet ?? activeWb?.sheets[0]?.name

  return (
    <>
      {sure > 0 && (
        <button
          className="flex shrink-0 items-center gap-1 whitespace-nowrap border-l border-border px-3 text-muted hover:text-fg"
          onClick={() => void acceptAllSuggestions(ACCEPT_ALL_MIN)}
          title={`Tag the ${sure} suggestions with confidence of 90% or more${sureBlocks ? ` (${sureBlocks} of them tables)` : ''}; ${open.length} cells suggested in all. Suggested “also reported as” facts are accepted one by one.`}
          data-testid="accept-all"
        >
          <CheckCheck size={12} /> Accept all ≥ 90% ({sure})
        </button>
      )}
      <button
        className="flex shrink-0 items-center gap-1 whitespace-nowrap border-l border-border px-3 text-muted hover:text-fg disabled:opacity-50"
        onClick={() => setDialogOpen(true)}
        disabled={autoTagging}
        title="Open Auto-Tag column dialog to specify line-item column, CY column, and PY gap"
        data-testid="auto-tag"
      >
        {autoTagging ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {autoTagging ? 'Auto-tagging…' : 'Auto-tag'}
      </button>

      <AutoTagColumnDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        defaultCol={defaultCol}
        workbookSource={activeWb?.source}
        sheetName={sheetName}
      />
    </>
  )
}
