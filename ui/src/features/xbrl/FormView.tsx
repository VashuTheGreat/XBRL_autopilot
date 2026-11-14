import { ArrowRightToLine, ChevronDown, ChevronRight, CircleSlash, Copy, FileSpreadsheet, Grid3x3, ListChecks, Table2 } from 'lucide-react'
import { useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { formatIndian } from '@xap/engine/basics'
import { rowTone, sourcesText, type FormCell, type FormDifference, type FormRow, type FormRowNote, type FormTable, type NoteTieView } from '@shared/editor'
import { cellKey } from '@shared/workbook'
import { EmptyState } from '@/components/EmptyState'
import { Button, Select } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { useEditor } from '@/stores/editor'
import { useSources } from '@/stores/sources'
import { useMandatory } from '@/stores/mandatory'
import { useProject } from '@/stores/project'
import { useValidation } from '@/stores/validation'
import { useFormTree } from './form-tree'

/**
 * XBRL Form: one statement (ELR) with its CY/PY facts and the Excel cell each value came from. The tree folds per head
 * (+ / −, Ctrl+E for all); lines carry E / L / T markers and turn red (mandatory empty, note differs) or green (tagged,
 * note ties).
 */
export function FormView() {
  const { form, activeElr, setActiveElr, selection, focusSeq, selectFact, fillMandatoryZeros, fillTableZeros, prefillDisclosures, goToNote, noteTarget } = useEditor()
  const { elrs, summary } = useProject()
  const selectedCellKey = selection.cell ? cellKey(selection.cell) : null
  const hasPy = !summary?.firstFinancialYear

  const options = useMemo(() => elrs.map((e) => ({ uri: e.uri, label: `[${e.code}] ${e.title}` })), [elrs])
  const activeElrInfo = useMemo(() => elrs.find((e) => e.uri === activeElr), [elrs, activeElr])
  const body = useRef<HTMLDivElement>(null)
  const tree = useFormTree(form)

  // the row of the selected cell's element comes into view (after the statement switch, when the form arrives).
  // Block body on purpose: scrollIntoView() returns a Promise in Electron's Chromium (see e2e/README gotchas).
  // A folded head or closed table that hides the row is opened first.
  useEffect(() => {
    if (!form || !selection.concept) return
    const key = selection.factKey
    const index = form.rows.findIndex((r) => r.concept === selection.concept)
    const tableId = key ? form.tables.find((t) => t.rows.some((r) => Object.values(r.cells).some((c) => c.factKey === key)))?.tableId : undefined
    tree.reveal({ ...(index >= 0 ? { row: index } : {}), ...(tableId ? { tableId } : {}) }, () => {
      // a table cell's fact first (its row in the table), else the element's row on the statement
      const row =
        (key && body.current?.querySelector<HTMLElement>(`[data-fact="${CSS.escape(key)}"]`)?.closest('tr')) ||
        body.current?.querySelector<HTMLElement>(`tr[data-concept="${CSS.escape(selection.concept!)}"]`)
      row?.scrollIntoView({ block: 'nearest' })
    })
  }, [form, selection.concept, focusSeq])

  // Go to note: once the note is open, its table (or the element's row) comes to the top
  useEffect(() => {
    if (!form || !noteTarget || form.elrUri !== noteTarget.elrUri) return
    const index = form.rows.findIndex((r) => r.concept === noteTarget.concept)
    tree.reveal({ ...(index >= 0 ? { row: index } : {}), ...(noteTarget.tableId ? { tableId: noteTarget.tableId } : {}) }, () => {
      const table = noteTarget.tableId ? body.current?.querySelector<HTMLElement>(`[data-table="${CSS.escape(noteTarget.tableId)}"]`) : null
      const target = table ?? body.current?.querySelector<HTMLElement>(`tr[data-concept="${CSS.escape(noteTarget.concept)}"]`)
      target?.scrollIntoView({ block: 'start' })
    })
  }, [form, noteTarget])

  // T: the table's grid opens and comes to the top
  const openTable = (tableId: string) =>
    tree.reveal({ tableId }, () => body.current?.querySelector<HTMLElement>(`[data-table="${CSS.escape(tableId)}"]`)?.scrollIntoView({ block: 'start' }))

  // Ctrl+E: expand / collapse the whole tree (while the Form has focus)
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'e') return
    e.preventDefault()
    tree.toggleAll()
  }

  // F7 = Go to note for the selected statement line (selected in the Form or through its Excel cell)
  const selectedNote = useMemo(
    () => form?.rows.find((r) => r.note && (r.concept === selection.concept || [r.cy, r.py].some((c) => c?.factKey && c.factKey === selection.factKey)))?.note,
    [form, selection.concept, selection.factKey],
  )
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F7' || !selectedNote) return
      e.preventDefault()
      void goToNote(selectedNote)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedNote, goToNote])

  return (
    <div className="flex h-full flex-col outline-none" tabIndex={-1} onKeyDown={onKeyDown} data-testid="form-view">
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
        <Button
          variant="ghost"
          className="h-7 shrink-0 px-2 text-[11px]"
          onClick={() => useMandatory.getState().openList()}
          title="The mandatory text, date and Yes/No items still empty in the whole filing, with inline inputs (amounts: Empty mandatory → 0)."
          data-testid="mandatory-items"
        >
          <ListChecks size={13} /> Mandatory items
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
              {form.rows.map((r, i) =>
                tree.hidden[i] ? null : (
                  <Row
                    key={`${r.concept ?? r.tableId ?? 'h'}-${i}`}
                    row={r}
                    hasPy={hasPy}
                    fold={tree.parents.has(i) ? (tree.collapsed.has(i) ? 'closed' : 'open') : null}
                    onFold={() => tree.toggleRow(i)}
                    onOpenTable={openTable}
                    selectedFact={selection.factKey}
                    selectedConcept={selection.concept ?? null}
                    selectedCell={selectedCellKey}
                    onPick={selectFact}
                    onGoToNote={goToNote}
                  />
                ),
              )}
            </tbody>
          </table>
          {form.tables.map((t) => (
            <TableGrid key={t.tableId} table={t} closed={tree.closedTables.has(t.tableId)} onToggle={() => tree.toggleTable(t.tableId)} selectedFact={selection.factKey} selectedCell={selectedCellKey} onPick={selectFact} />
          ))}
        </div>
      )}
      {form?.difference && <DifferenceFooter difference={form.difference} hasPy={hasPy} onShow={() => void useValidation.getState().showStatement(form.elrUri)} />}
    </div>
  )
}

function Row(props: {
  row: FormRow
  hasPy: boolean
  /** a head with lines below it: open (−) or closed (+) */
  fold: 'open' | 'closed' | null
  onFold(): void
  onOpenTable(tableId: string): void
  selectedFact: string | null
  selectedConcept: string | null
  selectedCell: string | null
  onPick(factKey: string | null): void
  onGoToNote(note: FormRowNote): void
}) {
  const { row: r } = props
  const openManualTag = useEditor((s) => s.openManualTag)
  const indent = { paddingLeft: `${1.25 + r.depth * 0.9}rem` }
  const fold = props.fold && <FoldButton state={props.fold} onClick={props.onFold} />
  if (r.kind !== 'item') {
    const openTable = r.tableId ? () => props.onOpenTable(r.tableId!) : undefined
    return (
      <tr className="border-b border-border/50" data-concept={r.concept ?? undefined} onDoubleClick={openTable} title={openTable ? 'Double-click to open the table' : undefined}>
        <td colSpan={props.hasPy ? 3 : 2} style={indent} className={cn('py-1 pr-3', r.kind === 'header' ? 'font-semibold' : 'italic text-muted')}>
          {fold}
          {r.kind === 'table' && !r.marker && <Table2 size={11} className="mr-1 inline" />}
          {r.marker && <MarkerBadge row={r} onActivate={openTable} />}
          {r.label}
        </td>
      </tr>
    )
  }
  if (r.dimensional) {
    return (
      <tr className="border-b border-border/50 text-muted">
        <td style={indent} className="py-1 pr-3" title={r.concept}>
          {fold}
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
  const tone = rowTone(r)
  const tagText = () => openManualTag({ concept: r.concept!, label: r.label })
  return (
    // scroll-mt: a row scrolled into view stops below the sticky column header, not behind it
    <tr
      className={cn('scroll-mt-9 scroll-mb-2 border-b border-border/50 hover:bg-panel-2', active && 'bg-accent/10', suggested && 'bg-warn/10')}
      data-concept={r.concept ?? undefined}
      data-testid="form-row"
      onDoubleClick={() => {
        if (r.concept) {
          openManualTag({ concept: r.concept, label: r.label, cell: r.cy?.source ?? r.py?.source ?? undefined })
        }
      }}
      title={r.concept ? `${r.concept}\nDouble-click to open manual tagging` : undefined}
    >
      <td style={indent} className="py-1 pr-3" title={rowTooltip(r, props.hasPy)}>
        {fold}
        {r.marker && <MarkerBadge row={r} onActivate={tagText} />}
        <span className={toneClass(tone)} data-testid="row-label" data-tone={tone ?? undefined}>
          {r.label}
        </span>
        {r.note && (
          <button
            className="ml-1.5 inline-flex align-middle text-muted hover:text-accent"
            onClick={(e) => {
              e.stopPropagation()
              props.onGoToNote(r.note!)
            }}
            title="Go to note (F7)"
            data-testid="go-to-note"
          >
            <ArrowRightToLine size={12} />
          </button>
        )}
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
function TableGrid(props: { table: FormTable; closed: boolean; onToggle(): void; selectedFact: string | null; selectedCell: string | null; onPick(factKey: string | null): void }) {
  const { table: t } = props
  const filled = t.rows.filter((r) => !r.abstract && t.columns.some((c) => r.cells[c.key]?.factKey))
  return (
    <section className="scroll-mt-9 border-t border-border" data-testid="form-table-grid" data-table={t.tableId} data-closed={props.closed || undefined}>
      <h3 className="flex items-center gap-1.5 bg-panel-2 px-3 py-1.5 text-[11px] font-semibold">
        <FoldButton state={props.closed ? 'closed' : 'open'} onClick={props.onToggle} />
        <Table2 size={12} /> {t.title}
        <span className="font-normal text-muted">
          {t.closed ? '· not applicable this year' : t.columns.length ? `· ${t.columns.length} column${t.columns.length === 1 ? '' : 's'}` : '· no values yet — drag over the note in Excel and use “Map as table”'}
        </span>
      </h3>
      {!props.closed && t.columns.length > 0 && (
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
                <tr
                  key={`${r.concept}|${r.preferredLabel ?? ''}`}
                  className="scroll-mt-9 border-b border-border/50 hover:bg-panel-2 cursor-pointer"
                  data-concept={r.concept}
                  onDoubleClick={() => {
                    if (r.concept) {
                      useEditor.getState().openManualTag({ concept: r.concept, label: r.label })
                    }
                  }}
                  title={r.concept ? `${r.concept}\nDouble-click to open manual tagging` : undefined}
                >
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

/** The cell's sources: all of a sum, else its one source cell. */
const chipSources = (c: FormCell) => c.sources ?? (c.source ? [{ cell: c.source, sign: 1 as const }] : [])

function ValueCell(props: { cell: FormCell | undefined; selectedFact: string | null; selectedCell: string | null; onPick(factKey: string | null): void }) {
  const c = props.cell
  if (!c) return <td />
  const selected = !!c.factKey && c.factKey === props.selectedFact
  return (
    <td
      className="px-3 py-1 text-right"
      data-fact={c.factKey ?? undefined}
      onDoubleClick={(e) => {
        if (c.mappingId) {
          e.stopPropagation()
          void useSources.getState().openDetails(c.mappingId)
        }
      }}
      title={c.mappingId ? 'Double-click for details (sources and total)' : undefined}
    >
      <button
        disabled={!c.factKey}
        onClick={() => props.onPick(c.factKey)}
        className={cn('tabular inline-flex items-center gap-1.5 rounded px-1 disabled:cursor-default', selected && 'outline outline-1 outline-accent', c.factKey && 'hover:bg-panel')}
      >
        {c.source && (
          <span
            className={cn('flex items-center gap-0.5 rounded bg-ok/15 px-1 font-mono text-[10px] text-ok', props.selectedCell === cellKey(c.source) && 'bg-accent/20 text-accent')}
            title={`${c.also ? 'Also reported from' : 'From'} ${sourcesText(chipSources(c))}${c.also ? ' (the same figure as that tag)' : ''}
Double-click the value for details`}
            data-testid="source-chip"
          >
            {c.also ? <Copy size={9} /> : <FileSpreadsheet size={9} />}
            {c.sources ? sourcesText(c.sources) : c.source.ref}
          </span>
        )}
        <span>{formatIndian(c.display)}</span>
      </button>
    </td>
  )
}

const TIE_TEXT: Record<NoteTieView['status'], string> = {
  ok: 'agrees with the note',
  mismatch: 'differs from the note',
  'note-empty': 'note not entered yet',
  'no-statement': 'nothing to compare',
  undetermined: 'the note’s values can’t be added up',
}

const TONE_CLASS = { ok: 'text-ok', bad: 'text-err' } as const
/** The line's colour (shared rowTone: note ties, mandatory, tagged). */
const toneClass = (tone: 'ok' | 'bad' | null) => (tone ? TONE_CLASS[tone] : undefined)

function FoldButton(props: { state: 'open' | 'closed'; onClick(): void }) {
  const Icon = props.state === 'open' ? ChevronDown : ChevronRight
  return (
    <button
      className="mr-0.5 -ml-3.5 inline-flex w-3 align-middle text-muted hover:text-fg"
      onClick={(e) => {
        e.stopPropagation()
        props.onClick()
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      title={props.state === 'open' ? 'Collapse (Ctrl+E: all)' : 'Expand (Ctrl+E: all)'}
      aria-expanded={props.state === 'open'}
      data-testid="form-fold"
    >
      <Icon size={12} />
    </button>
  )
}

const MARKER_TEXT: Record<NonNullable<FormRow['marker']>, string> = {
  E: 'Text block — double-click to tag the selected Excel text to it',
  L: 'Linked text block — the same text shows in other notes; double-click to tag the selected Excel text to it',
  T: 'Table — double-click to open it',
}

/** E / L / T badge; double-click does what the marker stands for (text tagging, open the table). */
function MarkerBadge(props: { row: FormRow; onActivate?: () => void }) {
  const m = props.row.marker!
  const linked = m === 'L' && props.row.linkedElrs?.length ? `\nAlso in: ${props.row.linkedElrs.join(', ')}` : ''
  return (
    <span
      className={cn('mr-1.5 inline-flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-sm align-middle font-mono text-[9px] font-bold', m === 'T' ? 'bg-accent/15 text-accent' : 'bg-warn/20 text-warn')}
      onDoubleClick={(e) => {
        e.stopPropagation()
        props.onActivate?.()
      }}
      title={MARKER_TEXT[m] + linked}
      data-testid="form-marker"
      data-marker={m}
    >
      {m}
    </span>
  )
}

/** The line's tooltip: element, note comparison, mandatory years, tagged. */
function rowTooltip(r: FormRow, hasPy: boolean): string | undefined {
  const years = r.mandatory && [r.mandatory.cy && 'CY', hasPy && r.mandatory.py && 'PY'].filter(Boolean).join(' & ')
  return [
    r.concept,
    r.note && noteTooltip(r.note, hasPy),
    years && `Mandatory, still empty (${years})${r.mandatory!.conditional ? ' — required by another answer' : ''}: ${r.mandatory!.rules.join(', ')}`,
    r.tagged && 'Tagged from Excel',
  ]
    .filter(Boolean)
    .join('\n') || undefined
}

/** "CY: statement 1,23,456 · note 1,20,000 · difference 3,456 (differs from the note)", one line per year. */
function noteTooltip(note: FormRowNote, hasPy: boolean): string {
  const year = (label: string, y: NoteTieView | undefined) => {
    if (!y) return null
    const parts = [y.statement != null && `statement ${formatIndian(y.statement)}`, y.note != null && `note ${formatIndian(y.note)}`, y.difference != null && `difference ${formatIndian(y.difference)}`].filter(Boolean)
    return `${label}: ${parts.length ? `${parts.join(' · ')} (${TIE_TEXT[y.status]})` : TIE_TEXT[y.status]}`
  }
  return [year('CY', note.cy), hasPy ? year('PY', note.py) : null, 'Go to note: F7'].filter(Boolean).join('\n')
}

/** "Difference CY 0 · PY 0": whether the statement's own totals add up; green at 0. Click: its problems. */
function DifferenceFooter(props: { difference: FormDifference; hasPy: boolean; onShow(): void }) {
  const d = props.difference
  const years = [['CY', d.cy], ...(props.hasPy ? [['PY', d.py]] : [])].filter((y): y is [string, string] => y[1] != null)
  const balanced = d.issues === 0 && years.every(([, v]) => v.replace(/[-0.,]/g, '') === '') // "0", "0.00", "-0": no float arithmetic on amounts
  return (
    <button
      className={cn('flex shrink-0 items-center gap-2 border-t border-border px-3 py-1 text-left text-[11px] hover:bg-panel-2', balanced ? 'text-ok' : 'text-err')}
      onClick={props.onShow}
      title={balanced ? 'Every total of this statement adds up. Click to list its problems.' : `${d.issues} total${d.issues === 1 ? '' : 's'} of this statement don’t add up. Click to list them in Problems.`}
      data-testid="form-difference"
      data-balanced={balanced}
    >
      <span className="font-medium">Difference</span>
      {years.map(([label, v], i) => (
        <span key={label} className="tabular">
          {i > 0 && '· '}
          {label} {formatIndian(v)}
        </span>
      ))}
      {d.issues > 0 && <span className="text-muted">({d.issues} total{d.issues === 1 ? '' : 's'} don’t add up)</span>}
    </button>
  )
}
