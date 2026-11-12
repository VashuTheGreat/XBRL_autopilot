import { CalendarRange, Columns3 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { columnLetter, fromA1 } from '@shared/workbook'
import { Button, Checkbox, Dialog, Field, Input } from '@/components/ui/primitives'
import { useEditor } from '@/stores/editor'
import { useProject } from '@/stores/project'

interface Props {
  open: boolean
  onClose(): void
  workbookSource?: string
  sheetName?: string
}

export function SheetColumnsDialog({ open, onClose, workbookSource, sheetName }: Props) {
  const { sheetColumns, setSheetColumns, workbooks, activeSource } = useEditor()
  const summary = useProject((s) => s.summary)
  const hasFilingPy = summary ? (!summary.firstFinancialYear && !!summary.py) : true

  const wbSource = workbookSource ?? activeSource ?? workbooks[0]?.source ?? ''
  const currentSheet = sheetName ?? useEditor.getState().selection.cell?.sheet ?? workbooks.find((w) => w.source === wbSource)?.sheets[0]?.name ?? ''

  const [cyCol, setCyCol] = useState(sheetColumns?.cyColumn ?? 'C')
  const [hasPy, setHasPy] = useState(hasFilingPy)
  const [gap, setGap] = useState(sheetColumns?.gap ?? 1)
  const [applyToAll, setApplyToAll] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      if (sheetColumns?.cyColumn) setCyCol(sheetColumns.cyColumn)
      if (sheetColumns?.gap) setGap(sheetColumns.gap)
      setHasPy(hasFilingPy && !!sheetColumns?.pyColumn)
    }
  }, [open, sheetColumns, hasFilingPy])

  const calculatedPyCol = () => {
    const parsed = fromA1(`${cyCol.trim().toUpperCase()}1`)
    if (!parsed) return ''
    return columnLetter(parsed.c + gap)
  }

  const handleSave = async () => {
    const cCol = cyCol.trim().toUpperCase()
    if (!cCol || !wbSource || !currentSheet) return

    setSaving(true)
    const pyLetter = hasPy ? calculatedPyCol() : null
    await setSheetColumns({
      workbook: wbSource,
      sheet: currentSheet,
      cyColumn: cCol,
      pyColumn: pyLetter,
      gap: hasPy ? gap : undefined,
      applyToAllSheets: applyToAll,
    })
    setSaving(false)
    onClose()
  }

  return (
    <Dialog
      open={open}
      title="Configure Sheet Columns (CY & PY)"
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSave()} disabled={saving || !cyCol.trim()}>
            <Columns3 size={13} /> {saving ? 'Saving…' : 'Save Columns'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-xs">
        <p className="text-muted">
          Specify which columns hold figures for <strong className="text-fg">{currentSheet}</strong>.
          Setting CY and PY columns enables both manual line tagging (WebXBRL dual tagging) and AI auto-tagging.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Current Year (CY) Column" hint="e.g. C or F">
            <Input
              value={cyCol}
              onChange={(e) => setCyCol(e.target.value.toUpperCase())}
              placeholder="C"
              maxLength={3}
              autoFocus
            />
          </Field>

          <div className="flex flex-col justify-end">
            <div className="rounded border border-border/60 bg-panel-2 p-2.5 text-[11px] text-muted flex items-center gap-2">
              <CalendarRange size={14} className="text-accent shrink-0" />
              <span>Current Year = <strong className="text-fg font-semibold">Col {cyCol || '?'}</strong></span>
            </div>
          </div>
        </div>

        {hasFilingPy && (
          <div className="rounded border border-border/60 bg-panel-2 p-3 flex flex-col gap-2">
            <Checkbox
              label="Has Previous Year (PY) Column"
              checked={hasPy}
              onChange={setHasPy}
            />
            {hasPy && (
              <div className="mt-1 flex items-center gap-3">
                <Field label="CY to PY Column Gap" hint="Columns to the right" className="flex-1">
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

        <div className="pt-1">
          <Checkbox
            label="Apply this column layout to all sheets in this workbook"
            checked={applyToAll}
            onChange={setApplyToAll}
          />
        </div>
      </div>
    </Dialog>
  )
}
