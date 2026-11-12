import { CircleSlash, Copy, FileSpreadsheet, Grid3x3, Table2 } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { formatIndian } from '@xap/engine/basics'
import type { FormCell, FormRow, FormTable } from '@shared/editor'
import { cellKey } from '@shared/workbook'
import { EmptyState } from '@/components/EmptyState'
import { Button, Select } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { useEditor } from '@/stores/editor'
import { useProject } from '@/stores/project'

/** XBRL Form: one statement (ELR) with its CY/PY facts and the Excel cell each value came from. */
export function FormView() {
  const { form, activeElr, setActiveElr, selection, focusSeq, selectFact, fillMandatoryZeros, fillTableZeros, prefillDisclosures } = useEditor()
  const { elrs, summary } = useProject()
  const selectedCellKey = selection.cell ? cellKey(selection.cell) : null
  const hasPy = !summary?.firstFinancialYear

  const options = useMemo(() => elrs.map((e) => ({ uri: e.uri, label: `[${e.code}] ${e.title}` })), [elrs])
  const activeElrInfo = useMemo(() => elrs.find((e) => e.uri === activeElr), [elrs, activeElr])
  const body = useRef<HTMLDivElement>(null)

  // the row of the selected cell's element comes into view (after the statement switch, when the form arrives).
  // Block body on purpose: scrollIntoView() returns a Promise in Electron's Chromium (see e2e/README gotchas).
  useEffect(() => {
    if (!form || !selection.concept) return
    // a table cell's fact first (its row in the table), else the element's row on the statement
    const row =
      (selection.factKey && body.current?.querySelector<HTMLElement>(`[data-fact="${CSS.escape(selection.factKey)}"]`)?.closest('tr')) ||
      body.current?.querySelector<HTMLElement>(`tr[data-concept="${CSS.escape(selection.concept)}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [form, selection.concept, focusSeq])

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
        <Button
          variant="ghost"
          className="h-7 shrink-0 px-2 text-[11px]"
          disabled={!activeElr}
          onClick={() => void fillMandatoryZeros()}
          title="Report the mandatory amounts this statement leaves empty (lines the company doesn't have) as 0. Text fields are left to you."
        >
          <CircleSlash size={13} /> Empty mandatory → 0
        </Button>
        {!!form?.tables.length && (
          <Button
            variant="ghost"
            className="h-7 shrink-0 px-2 text-[11px]"
            onClick={() => void fillTableZeros()}
            title="In this statement's tables, report as 0 the line items the MCA rules require in columns that already have a value. Columns with no value are never started."
            data-testid="table-zeros"
          >
            <Grid3x3 size={13} /> Table zeros → 0
          </Button>
        )}
        {activeElrInfo?.group === 'Disclosures' && (
          <Button
            variant="ghost"
            className="h-7 shrink-0 px-2 text-[11px]"
            onClick={() => void prefillDisclosures()}
            title="Prefill this disclosure form (company, auditors, directors/KMP tables, signatories, Yes/No questions) from last year's filed instance."
            data-testid="prefill-disclosures"
          >
            <Copy size={13} /> Prefill from last year
          </Button>
        )}
      </div>
      {!form ? (
        <EmptyState icon={Table2} title="Loading statement…" />
      ) : (
        <div ref={body} className="min-h-0 flex-1 overflow-auto">
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
                <Row key={`${r.concept ?? r.tableId ?? 'h'}-${i}`} row={r} hasPy={hasPy} selectedFact={selection.factKey} selectedConcept={selection.concept ?? null} selectedCell={selectedCellKey} onPick={selectFact} />
              ))}
            </tbody>
          </table>
          {form.tables.map((t) => (
            <TableGrid key={t.tableId} table={t} selectedFact={selection.factKey} selectedCell={selectedCellKey} onPick={selectFact} />
          ))}
        </div>
      )}
    </div>
  )
}

function Row(props: { row: FormRow; hasPy: boolean; selectedFact: string | null; selectedConcept: string | null; selectedCell: string | null; onPick(factKey: string | null): void }) {
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
  // a suggested (not yet accepted) tag has no fact: its row is marked by the element
  const suggested = !active && !!r.concept && r.concept === props.selectedConcept
  return (
    // scroll-mt: a row scrolled into view stops below the sticky column header, not behind it
    <tr className={cn('scroll-mt-9 scroll-mb-2 border-b border-border/50 hover:bg-panel-2', active && 'bg-accent/10', suggested && 'bg-warn/10')} data-concept={r.concept ?? undefined} data-testid="form-row">
      <td style={indent} className="py-1 pr-3" title={r.concept}>
        {r.label}
      </td>
      <ValueCell cell={r.cy} {...props} />
      {props.hasPy && <ValueCell cell={r.py} {...props} />}
    </tr>
  )
}

/**
 * One dimensional table of the statement: a column per member combination that holds a value, per year; rows with no
 * value are folded away (their count is shown). Map a range with “Map as table” to fill it from Excel.
 */
function TableGrid(props: { table: FormTable; selectedFact: string | null; selectedCell: string | null; onPick(factKey: string | null): void }) {
  const { table: t } = props
  const filled = t.rows.filter((r) => !r.abstract && t.columns.some((c) => r.cells[c.key]?.factKey))
  return (
    <section className="border-t border-border" data-testid="form-table-grid" data-table={t.tableId}>
      <h3 className="flex items-center gap-1.5 bg-panel-2 px-3 py-1.5 text-[11px] font-semibold">
        <Table2 size={12} /> {t.title}
        <span className="font-normal text-muted">
          {t.closed ? '· not applicable this year' : t.columns.length ? `· ${t.columns.length} column${t.columns.length === 1 ? '' : 's'}` : '· no values yet — drag over the note in Excel and use “Map as table”'}
        </span>
      </h3>
      {t.columns.length > 0 && (
        <div className="overflow-x-auto">
          <table className="border-collapse text-[12px]">
            <thead className="text-[11px] text-muted">
              <tr>
                <th className="min-w-56 px-3 py-1 text-left font-medium">Line item</th>
                {t.columns.map((c) => (
                  <th key={c.key} className="min-w-32 px-3 py-1 text-right font-medium" title={c.dims.map((d) => d.member ?? d.typed).join('\n')}>
                    {c.label} <span className="rounded bg-panel-2 px-1 text-[10px]">{c.scope}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filled.map((r) => (
                <tr key={`${r.concept}|${r.preferredLabel ?? ''}`} className="scroll-mt-9 border-b border-border/50 hover:bg-panel-2" data-concept={r.concept}>
                  <td className="py-1 pr-3" style={{ paddingLeft: `${0.75 + Math.max(0, r.depth - 1) * 0.9}rem` }} title={r.concept}>
                    {r.label}
                  </td>
                  {t.columns.map((c) => (
                    <ValueCell key={c.key} cell={r.cells[c.key]} selectedFact={props.selectedFact} selectedCell={props.selectedCell} onPick={props.onPick} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {filled.length < t.rows.filter((r) => !r.abstract).length && (
            <p className="px-3 py-1 text-[10px] text-muted">{t.rows.filter((r) => !r.abstract).length - filled.length} line items without a value are not shown.</p>
          )}
        </div>
      )}
    </section>
  )
}

function ValueCell(props: { cell: FormCell | undefined; selectedFact: string | null; selectedCell: string | null; onPick(factKey: string | null): void }) {
  const c = props.cell
  if (!c) return <td />
  const selected = !!c.factKey && c.factKey === props.selectedFact
  return (
    <td className="px-3 py-1 text-right" data-fact={c.factKey ?? undefined}>
      <button
        disabled={!c.factKey}
        onClick={() => props.onPick(c.factKey)}
        className={cn('tabular inline-flex items-center gap-1.5 rounded px-1 disabled:cursor-default', selected && 'outline outline-1 outline-accent', c.factKey && 'hover:bg-panel')}
      >
        {c.source && (
          <span
            className={cn('flex items-center gap-0.5 rounded bg-ok/15 px-1 font-mono text-[10px] text-ok', props.selectedCell === cellKey(c.source) && 'bg-accent/20 text-accent')}
            title={c.also ? `Also reported from ${c.source.sheet}!${c.source.ref} (the same figure as that cell’s tag)` : `From ${c.source.sheet}!${c.source.ref}`}
            data-testid="source-chip"
          >
            {c.also ? <Copy size={9} /> : <FileSpreadsheet size={9} />}
            {c.source.ref}
          </span>
        )}
        <span>{formatIndian(c.display)}</span>
      </button>
    </td>
  )
}
