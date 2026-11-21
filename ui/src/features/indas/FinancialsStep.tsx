import { useState } from 'react'
import { Download, FileSpreadsheet, Upload } from 'lucide-react'
import { CANONICAL_SHEETS } from '@shared/indas'
import { Button } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { useIndas } from '@/stores/indas'
import { formatAmount } from './model'

const SHEET_TITLES: Record<string, string> = {
  CANONICAL_BS: 'Balance Sheet',
  CANONICAL_PL: 'Profit & Loss',
  CANONICAL_CF: 'Cash Flow',
  CANONICAL_SOCIE: 'Changes in Equity',
  CANONICAL_PPE_SCHEDULE: 'PPE schedule',
  CANONICAL_FINANCIAL_NOTES: 'Notes',
}

/** Step 1: upload the workbook (or the filled standard template) and review the canonical sheets. */
export function FinancialsStep() {
  const { transform, upload, saveTemplate, busy } = useIndas()
  const [sheet, setSheet] = useState<string>(CANONICAL_SHEETS[0])
  const rows = transform?.sheets[sheet] ?? []
  const columns = rows.length ? Object.keys(rows[0]) : []

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-6">
      <div className="grid gap-3 md:grid-cols-2">
        <section className="rounded-md border border-border bg-panel p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Upload size={15} /> Upload financial statements
          </h2>
          <p className="mt-1 text-xs text-muted">
            Your client's Excel (.xls / .xlsx). It is converted into six standard sheets. A filled standard template is read exactly as it is.
          </p>
          <Button variant="primary" className="mt-3" disabled={!!busy} onClick={() => void upload()} data-testid="indas-upload">
            <FileSpreadsheet size={14} /> Choose workbook…
          </Button>
        </section>
        <section className="rounded-md border border-border bg-panel p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Download size={15} /> Standard template
          </h2>
          <p className="mt-1 text-xs text-muted">
            Our six-sheet format with instructions. Fill it by hand or with any AI tool, then upload it here for an exact read.
          </p>
          <Button className="mt-3" disabled={!!busy} onClick={() => void saveTemplate()} data-testid="indas-template">
            <Download size={14} /> Download template…
          </Button>
        </section>
      </div>

      {transform && (
        <section className="rounded-md border border-border bg-panel">
          <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <span className="text-xs font-semibold">{transform.fileName}</span>
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[11px]',
                transform.source === 'standard_template' ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn',
              )}
            >
              {transform.source === 'standard_template' ? 'Standard template: read exactly' : 'Converted automatically: check the rows'}
            </span>
            <div className="ml-auto flex flex-wrap gap-1">
              {CANONICAL_SHEETS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSheet(s)}
                  className={cn('rounded px-2 py-0.5 text-[11px]', s === sheet ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-panel-2')}
                >
                  {SHEET_TITLES[s] ?? s} ({transform.sheets[s]?.length ?? 0})
                </button>
              ))}
            </div>
          </header>
          {rows.length === 0 ? (
            <p className="p-6 text-center text-xs text-muted">No rows in this sheet.</p>
          ) : (
            <div className="max-h-[55vh] overflow-auto">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-panel-2 text-left text-muted">
                  <tr>
                    {columns.map((c) => (
                      <th key={c} className="whitespace-nowrap px-2 py-1.5 font-medium">
                        {c.replace(/_/g, ' ')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t border-border/60">
                      {columns.map((c) => (
                        <td key={c} className={cn('px-2 py-1', typeof r[c] === 'number' && 'text-right font-mono tabular-nums')}>
                          {typeof r[c] === 'number' ? formatAmount(r[c] as number) : String(r[c] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
