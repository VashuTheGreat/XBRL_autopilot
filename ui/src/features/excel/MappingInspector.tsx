import { CalendarRange, Check, Copy, Link2, Search, Sparkles, Table2, Tag, Unlink, X } from 'lucide-react'
import { formatIndian } from '@xap/engine/basics'
import { useState, type ReactNode } from 'react'
import type { CellAmount, ColumnPeriod, MappingView, Scope, SuggestedAlsoView } from '@shared/editor'
import { cellKey, rangeOf, rangeSize } from '@shared/workbook'
import { Button } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { useEditor } from '@/stores/editor'
import { useTables } from '@/stores/tables'
import { useUi } from '@/stores/ui'

const SCOPES: Scope[] = ['CY', 'PY']

/** Strip under the grid: what the selected cell is tagged as, with quick actions (docs/08-ui-ux.md). */
export function MappingInspector() {
  const { selection, byCell, mappings, workbooks, cellInfo, untag, setScope, selectFact, openManualTag } = useEditor()
  const setActivity = useUi((s) => s.setActivity)
  // a text cell can hold several figures (share counts in a note), one mapping each: which one the strip shows
  const [figure, setFigure] = useState<{ key: string; i: number }>({ key: '', i: 0 })
  const cell = selection.cell
  if (!cell) {
    return <footer className="flex h-9 shrink-0 items-center border-t border-border px-3 text-[11px] text-muted">Select a cell to see or set its tag.</footer>
  }
  const at = rangeOf(cell.ref)
  const cellCount = rangeSize(cell.ref)
  const raw = workbooks
    .find((w) => w.source === cell.workbook)
    ?.sheets.find((s) => s.name === cell.sheet)
    ?.cells.find((c) => at && c.r === at.r1 && c.c === at.c1)?.v
  const key = cellKey(cell)
  const figures = mappings.filter((x) => x.pick !== undefined && cellKey(x.cell) === key).sort((a, b) => a.pick! - b.pick!)
  const m = figures.length > 1 ? figures[figure.key === key ? Math.min(figure.i, figures.length - 1) : 0] : byCell.get(key)
  const info = cellInfo && cellKey(cellInfo.cell) === cellKey(cell) ? cellInfo : null

  return (
    <footer className="flex h-9 shrink-0 items-center gap-3 border-t border-border px-3 text-xs" data-testid="inspector">
      <span className="font-mono text-muted">
        {cell.sheet}!{cell.ref}
      </span>
      {cellCount > 1 && <span className="shrink-0 text-[11px] text-muted">sum of {cellCount} cells</span>}
      {info?.amount ? (
        <AmountText amount={info.amount} />
      ) : (
        <span className="max-w-40 truncate tabular" title={raw == null ? '' : String(raw)}>
          {raw == null ? <span className="text-muted">empty</span> : typeof raw === 'number' ? formatIndian(String(raw)) : String(raw)}
        </span>
      )}
      {figures.length > 1 && (
        <span className="flex shrink-0 gap-0.5" data-testid="text-figures" title="The figures written in this cell’s text, one tag each">
          {figures.map((x, i) => (
            <button
              key={x.id}
              className={cn('rounded px-1 font-mono text-[10px]', x === m ? 'bg-accent text-accent-fg' : 'border border-border text-muted')}
              title={`${x.conceptLabel} (${x.fact.scope})`}
              onClick={() => setFigure({ key, i })}
            >
              #{x.pick! + 1}
            </button>
          ))}
        </span>
      )}
      <span className="h-4 w-px bg-border" />
      {m?.status === 'suggested' ? (
        <SuggestionControls m={m} onScope={(s) => void setScope(m.id, s)} />
      ) : m?.status === 'rejected' ? (
        <>
          <span className="shrink-0 text-muted" title={m.conceptLabel}>
            Suggestion rejected.
          </span>
          <div className="flex-1" />
          <Button variant="ghost" className="h-6 shrink-0 px-2" onClick={() => openManualTag({ cell })} title="Open manual tagging interface (or double-click cell)">
            <Tag size={13} className="mr-1" /> Tag Element…
          </Button>
          <Button variant="ghost" className="h-6 shrink-0 px-2" onClick={() => setActivity('taxonomy')}>
            <Search size={13} /> Browse taxonomy
          </Button>
        </>
      ) : m ? (
        <>
          <button className="flex min-w-0 items-center gap-1.5 hover:underline" title={`${m.fact.concept}\nClick to scroll in statement, or double-click to edit`} onClick={() => selectFact(m.factKey)}>
            {m.fact.dims.length ? <Table2 size={13} className="shrink-0 text-ok" /> : <Link2 size={13} className="shrink-0 text-ok" />}
            <span className="truncate">{m.conceptLabel}</span>
            <span
              className={cn(
                'rounded px-1.5 py-0.2 font-sans text-[10px] font-semibold',
                m.origin === 'manual' ? 'bg-ok/20 text-ok border border-ok/30' : 'bg-accent/20 text-accent border border-accent/30',
              )}
            >
              {m.origin === 'manual' ? 'Manual' : m.origin}
            </span>
            {m.fact.dims.length > 0 && <span className="shrink-0 text-[11px] text-muted">in table</span>}
          </button>
          <Segmented label="Period" value={m.fact.scope} onPick={(s) => void setScope(m.id, s)} />
          {m.sign === -1 && <span className="text-[11px] text-warn">sign reversed</span>}
          <AlsoReported m={m} />
          <div className="flex-1" />
          <Button variant="ghost" className="h-6 px-2 text-xs" onClick={() => openManualTag({ cell })} title="Edit tag (or double-click cell)">
            <Tag size={12} className="mr-1" /> Edit Tag
          </Button>
          <Button variant="ghost" className="h-6 px-2" onClick={() => void untag(m.id)} title="Remove this tag">
            <Unlink size={13} /> Untag
          </Button>
        </>
      ) : (
        <>
          {info?.column && <ColumnPeriodText column={info.column} />}
          <span className="shrink-0 text-muted">Not tagged.</span>
          <div className="flex-1" />
          <Button variant="ghost" className="h-6 shrink-0 px-2" onClick={() => openManualTag({ cell })} title="Open manual tagging interface (or double-click cell)">
            <Tag size={13} className="mr-1" /> Tag Element…
          </Button>
          <Button variant="ghost" className="h-6 shrink-0 px-2" onClick={() => setActivity('taxonomy')}>
            <Search size={13} /> Browse taxonomy
          </Button>
        </>
      )}
    </footer>
  )
}

/**
 * "Also reported as": the other facts this cell's figure is filed as, each removable; the suggested ones, each to
 * accept or reject; and a way to add one.
 */
function AlsoReported({ m }: { m: MappingView }) {
  const { removeAlso, selectFact, acceptAlso, rejectAlso } = useEditor()
  const open = useTables((s) => s.open)
  return (
    <span className="flex min-w-0 items-center gap-1" data-testid="also-reported">
      {m.alsoViews.map((a, i) => (
        <span key={i} className="flex min-w-0 items-center gap-0.5 rounded bg-ok/10 px-1 text-[11px] text-ok" title={`Also reported as ${a.conceptLabel} [${a.memberLabels.join(', ')}] ${a.fact.scope}`}>
          <button className="truncate hover:underline" onClick={() => selectFact(a.factKey)}>
            also: {a.memberLabels.join(' · ') || a.conceptLabel}
          </button>
          <button aria-label="Stop reporting this fact" onClick={() => void removeAlso(m.id, i)}>
            <X size={10} />
          </button>
        </span>
      ))}
      {m.alsoSuggestedViews.map((a, i) => (
        <SuggestedAlsoChip key={`s${i}`} a={a}>
          <button aria-label="Also report this fact" title="Also report this figure as that fact" onClick={() => void acceptAlso(m.id, i)} data-testid="also-accept">
            <Check size={11} />
          </button>
          <button aria-label="Don’t report this fact" onClick={() => void rejectAlso(m.id, i)} data-testid="also-reject">
            <X size={10} />
          </button>
        </SuggestedAlsoChip>
      ))}
      <button
        className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted hover:text-fg"
        onClick={() => open({ kind: 'also', mappingId: m.id, concept: m.fact.concept })}
        title="Also report this figure as a table fact (e.g. a share class or an asset class column)"
        data-testid="also-add"
      >
        <Copy size={11} /> Also as…
      </button>
    </span>
  )
}

/** A suggested "also reported as" fact: amber, with its confidence; the actions are the caller's. */
function SuggestedAlsoChip({ a, children }: { a: SuggestedAlsoView; children?: ReactNode }) {
  const what = a.memberLabels.join(' · ') || a.conceptLabel
  return (
    <span
      className="flex min-w-0 items-center gap-0.5 rounded border border-dashed border-warn/60 px-1 text-[11px] text-warn"
      title={`Suggested: also report as ${a.conceptLabel} [${a.memberLabels.join(', ')}] ${a.fact.scope}, ${Math.round(a.fact.confidence * 100)}%${a.fact.reason ? ` (${a.fact.reason})` : ''}`}
      data-testid="also-suggested"
    >
      <span className="truncate">also: {what} (suggested)</span>
      {children}
    </span>
  )
}

const ORIGIN_TEXT: Record<string, string> = {
  memory: 'tagged so before',
  exact: 'label match',
  lexical: 'word match',
  ai: 'AI',
  table: 'table match',
}

/** An auto-tagging suggestion for the cell: the element, its confidence and why; accept, pick an alternative, or reject. */
function SuggestionControls({ m, onScope }: { m: MappingView; onScope: (s: Scope) => void }) {
  const { acceptSuggestion, rejectSuggestion } = useEditor()
  const pct = Math.round((m.confidence ?? 0) * 100)
  const alternatives = m.alternatives ?? []
  return (
    <>
      <span className="flex min-w-0 items-center gap-1.5" title={`${m.fact.concept}\n${m.rationale ?? ''}`} data-testid="suggestion">
        <Sparkles size={13} className="shrink-0 text-warn" />
        <span className="truncate">{m.conceptLabel}</span>
        <span className={cn('shrink-0 rounded px-1 text-[10px]', pct >= 90 ? 'bg-ok/15 text-ok' : pct >= 60 ? 'bg-warn/15 text-warn' : 'bg-err/15 text-err')} data-testid="suggestion-confidence">
          {pct}%
        </span>
        <span className="shrink-0 text-[11px] text-muted">{ORIGIN_TEXT[m.origin] ?? m.origin}</span>
      </span>
      <Segmented label="Period" value={m.fact.scope} onPick={onScope} />
      {m.sign === -1 && <span className="text-[11px] text-warn">sign reversed</span>}
      {/* offered for review once the cell is tagged */}
      {m.alsoSuggestedViews.map((a, i) => (
        <SuggestedAlsoChip key={i} a={a} />
      ))}
      {alternatives.length > 0 && (
        <select
          className="h-6 max-w-44 shrink rounded border border-border bg-panel px-1 text-[11px] text-muted"
          aria-label="Accept an alternative element"
          value=""
          onChange={(e) => e.target.value && void acceptSuggestion(m.id, e.target.value)}
        >
          <option value="">Other suggestions…</option>
          {alternatives.map((a) => (
            <option key={a.concept} value={a.concept} title={a.concept}>
              {a.label} ({Math.round(a.score * 100)}%)
            </option>
          ))}
        </select>
      )}
      <div className="flex-1" />
      <Button variant="primary" className="h-6 shrink-0 px-2" onClick={() => void acceptSuggestion(m.id)} data-testid="accept-suggestion">
        <Check size={13} /> Accept
      </Button>
      <Button variant="ghost" className="h-6 shrink-0 px-2" onClick={() => void rejectSuggestion(m.id)} data-testid="reject-suggestion">
        <X size={13} /> Reject
      </Button>
    </>
  )
}

/** The amount that goes into the filing; when Excel's stored number was rounded, says so. */
function AmountText({ amount }: { amount: CellAmount }) {
  const from = amount.placesFrom === 'format' ? 'the cell’s number format' : amount.placesFrom === 'filing' ? 'the filing’s decimal places' : 'the typed figure'
  const title = amount.rounded
    ? `Excel stores ${amount.exact}; rounded to ${amount.places} decimal place(s) from ${from}.`
    : `${amount.places} decimal place(s), from ${from}.`
  return (
    <span className="flex shrink-0 items-center gap-1 tabular" title={title} data-testid="inspector-amount">
      {formatIndian(amount.value)}
      {amount.rounded && <span className="rounded bg-panel-2 px-1 text-[10px] text-muted">rounded</span>}
    </span>
  )
}

/** The column's period with a control to set it; warns when the header names another period. */
function ColumnPeriodText({ column }: { column: ColumnPeriod }) {
  const setColumnPeriod = useEditor((s) => s.setColumnPeriod)
  const outside = column.basis === 'outside'
  const text = outside
    ? `Column ${column.column} isn’t part of this filing`
    : column.scope
      ? `Column ${column.column}: ${column.scope}`
      : `Column ${column.column}: period unknown`
  return (
    <span className="flex min-w-0 items-center gap-1.5" data-testid="column-period" data-basis={column.basis}>
      <CalendarRange size={13} className={cn('shrink-0', outside || !column.scope ? 'text-warn' : 'text-muted')} />
      <span className={cn('truncate', outside || !column.scope ? 'text-warn' : 'text-muted')} title={column.reason}>
        {text}
      </span>
      <Segmented label={`Period of column ${column.column}`} value={column.basis === 'remembered' ? column.scope : null} onPick={(s) => void setColumnPeriod(s)} />
      {column.basis === 'remembered' && (
        <button className="shrink-0 text-[11px] text-muted hover:text-fg hover:underline" onClick={() => void setColumnPeriod(null)} title="Forget this choice and use the column header">
          auto
        </button>
      )}
    </span>
  )
}

function Segmented({ label, value, onPick }: { label: string; value: Scope | null; onPick: (s: Scope) => void }) {
  return (
    <div className="flex shrink-0 overflow-hidden rounded border border-border" role="group" aria-label={label}>
      {SCOPES.map((s) => (
        <button key={s} onClick={() => onPick(s)} aria-pressed={value === s} className={cn('px-2 py-0.5 text-[11px]', value === s ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg')}>
          {s}
        </button>
      ))}
    </div>
  )
}
