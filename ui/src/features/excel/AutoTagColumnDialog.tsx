/**
 * AutoTagColumnDialog: lets the user specify which column has the line-item descriptions.
 * Uses the sheet's globally configured CY and PY figure columns (or lets the user set them).
 * Empty cells are automatically skipped and stripped.
 */
import { Columns3, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { columnLetter, fromA1 } from '@shared/workbook'
import { Button, Checkbox, Dialog, Field, Input } from '@/components/ui/primitives'
import { useEditor } from '@/stores/editor'
import { useProject } from '@/stores/project'

interface Props {
  open: boolean
  onClose(): void
  defaultCol?: string
  workbookSource?: string
  sheetName?: string
}

export function AutoTagColumnDialog({ open, onClose, defaultCol = 'B', workbookSource, sheetName }: Props) {
  const { autoTag, autoTagging, sheetColumns } = useEditor()
  const summary = useProject((s) => s.summary)
  const hasFilingPy = summary ? (!summary.firstFinancialYear && !!summary.py) : true

  const [labelCol, setLabelCol] = useState(defaultCol)
  const [cyCol, setCyCol] = useState(sheetColumns?.cyColumn ?? 'C')
  const [hasPy, setHasPy] = useState(hasFilingPy && (sheetColumns?.pyColumn !== null))
  const [gap, setGap] = useState(sheetColumns?.gap ?? 1)
  const [showOverride, setShowOverride] = useState(!sheetColumns?.cyColumn)

  useEffect(() => {
    if (defaultCol) setLabelCol(defaultCol.toUpperCase())
  }, [defaultCol])

  useEffect(() => {
    if (open) {
      if (sheetColumns?.cyColumn) {
        setCyCol(sheetColumns.cyColumn)
        setHasPy(hasFilingPy && !!sheetColumns.pyColumn)
        if (sheetColumns.gap) setGap(sheetColumns.gap)
        setShowOverride(false)
      } else {
        setShowOverride(true)
      }
    }
  }, [open, sheetColumns, hasFilingPy])

  const calculatedPyCol = () => {
    const parsed = fromA1(`${cyCol.trim().toUpperCase()}1`)
    if (!parsed) return ''
    return columnLetter(parsed.c + gap)
  }

  const handleRun = async () => {
    const lCol = labelCol.trim().toUpperCase()
    const cCol = cyCol.trim().toUpperCase()
    if (!lCol || !cCol) return

    const pyLetter = hasPy ? calculatedPyCol() : undefined
    await autoTag({
      workbook: workbookSource,
      sheet: sheetName,
      labelColumn: lCol,
      cyColumn: cCol,
      pyColumn: pyLetter,
      gap: hasPy ? gap : undefined,
      saveConfig: true,
    })
    onClose()
  }

  return (
    <Dialog
      open={open}
      title="Auto-Tag Column (Hybrid Search)"
      onClose={onClose}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={autoTagging}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleRun()} disabled={autoTagging || !labelCol || !cyCol}>
            <Sparkles size={13} /> {autoTagging ? 'Tagging…' : 'Run Auto-Tag'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-xs">
        <p className="text-muted">
          Specify the line-item description column to auto-tag using the Hybrid AI Retriever.
          Figures will be tagged from the sheet&apos;s configured CY and PY columns.
        </p>

        <Field label="Description / Labels Column" hint="e.g. B or A">
          <Input
            value={labelCol}
            onChange={(e) => setLabelCol(e.target.value.toUpperCase())}
            placeholder="B"
            maxLength={3}
            autoFocus
          />
        </Field>

        {/* Global/Sheet Figure Columns Status */}
        <div className="rounded border border-border/60 bg-panel-2 p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-fg flex items-center gap-1.5">
              <Columns3 size={13} className="text-accent" /> Figure Columns:
            </span>
            <button
              type="button"
              onClick={() => setShowOverride(!showOverride)}
              className="text-[11px] text-accent hover:underline"
            >
              {showOverride ? 'Hide options' : 'Change CY/PY…'}
            </button>
          </div>

          <div className="text-muted text-[11px]">
            Current Year (CY): <strong className="text-fg font-medium">Col {cyCol}</strong>
            {hasPy && hasFilingPy && (
              <>
                <span className="mx-1.5 opacity-40">·</span>
                Previous Year (PY): <strong className="text-fg font-medium">Col {calculatedPyCol()}</strong> (Gap: {gap})
              </>
            )}
          </div>

          {showOverride && (
            <div className="mt-2 pt-2 border-t border-border/40 flex flex-col gap-3">
              <Field label="Current Year (CY) Figures Column" hint="e.g. C">
                <Input
                  value={cyCol}
                  onChange={(e) => setCyCol(e.target.value.toUpperCase())}
                  placeholder="C"
                  maxLength={3}
                />
              </Field>

              {hasFilingPy && (
                <div className="flex flex-col gap-2">
                  <Checkbox
                    label="Also Tag Previous Year (PY) Column"
                    checked={hasPy}
                    onChange={setHasPy}
                  />
                  {hasPy && (
                    <div className="mt-1 flex items-center gap-3">
                      <Field label="CY to PY Column Gap" hint="Number of columns to the right" className="flex-1">
                        <Input
                          type="number"
                          min={1}
                          max={10}
                          value={gap}
                          onChange={(e) => setGap(Math.max(1, parseInt(e.target.value) || 1))}
                        />
                      </Field>
                      <div className="mt-2 text-muted">
                        &rarr; PY will be Column <span className="font-semibold text-fg">{calculatedPyCol()}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="text-[11px] text-muted italic">
          Tip: If your spreadsheet has descriptions in multiple columns (e.g. Note descriptions in Col A and Sub-items in Col B),
          you can run Auto-Tag on one column first, and then run it on the other column.
        </div>
      </div>
    </Dialog>
  )
}
