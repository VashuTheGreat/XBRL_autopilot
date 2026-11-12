import { MousePointerClick, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ConceptHit, Scope } from '@shared/editor'
import { columnLetter, fromA1 } from '@shared/workbook'
import { unwrap } from '@/lib/result'
import { cn } from '@/lib/cn'
import { useEditor } from '@/stores/editor'

/**
 * Taxonomy browser. webXBRL-style tagging: select an Excel cell, then double-click an element.
 * The period comes from the column header; the CY/PY buttons override it.
 */
export function TaxonomyPanel() {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ConceptHit[]>([])
  const [active, setActive] = useState<string | null>(null)
  const { selection, tagSelected, sheetColumns } = useEditor()

  const parsed = selection.cell ? fromA1(selection.cell.ref) : null
  const currentCol = parsed ? columnLetter(parsed.c) : null
  const isParticulars = !!(
    parsed &&
    currentCol &&
    sheetColumns?.cyColumn &&
    currentCol !== sheetColumns.cyColumn &&
    (!sheetColumns.pyColumn || currentCol !== sheetColumns.pyColumn)
  )

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) return setHits([])
    const t = setTimeout(async () => setHits((await unwrap(window.xap.editor.searchConcepts(q), { quiet: true })) ?? []), 150)
    return () => clearTimeout(t)
  }, [query])

  const tag = (h: ConceptHit, scope?: Scope) => void tagSelected(h.qname, scope)

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 border-b border-border p-2">
        <div className="relative">
          <Search size={13} className="absolute top-2 left-2 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search elements, e.g. share capital"
            className="h-7 w-full rounded border border-border bg-panel pr-2 pl-7 text-xs outline-none focus:border-accent select-text"
            data-testid="taxonomy-search"
          />
        </div>
        <p className="flex items-center gap-1.5 text-[11px] text-muted">
          <MousePointerClick size={12} />
          {selection.cell ? (
            isParticulars ? (
              <>
                Double-click to tag Row <span className="font-mono text-fg">{parsed?.r}</span> (CY: Col {sheetColumns?.cyColumn}
                {sheetColumns?.pyColumn ? `, PY: Col ${sheetColumns?.pyColumn}` : ''})
              </>
            ) : (
              <>
                Double-click an element to tag <span className="font-mono text-fg">{selection.cell.sheet}!{selection.cell.ref}</span>
              </>
            )
          ) : (
            'Select a cell in the Excel pane, then double-click an element.'
          )}
        </p>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto py-1 text-[12px]" role="listbox" aria-label="Taxonomy elements">
        {hits.map((h) => (
          <li
            key={h.qname}
            role="option"
            aria-selected={active === h.qname}
            onClick={() => setActive(h.qname)}
            onDoubleClick={() => tag(h)}
            title={`${h.qname}\nDouble-click to tag`}
            className={cn('group cursor-default px-3 py-1.5 hover:bg-panel-2', active === h.qname && 'bg-panel-2', !h.nonDimensional && 'opacity-60')}
          >
            <div className="flex items-start gap-2">
              <span className="flex-1 leading-snug">{h.label}</span>
              {h.nonDimensional && selection.cell && (
                <span className="hidden shrink-0 gap-1 group-hover:flex">
                  {isParticulars ? (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); tag(h) }}
                        className="rounded border border-border px-1 text-[10px] text-muted hover:text-fg"
                        title={`Tag both CY (${sheetColumns?.cyColumn}${parsed?.r}) and PY (${sheetColumns?.pyColumn}${parsed?.r})`}
                      >
                        Both
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); tag(h, 'CY') }}
                        className="rounded border border-border px-1 text-[10px] text-muted hover:text-fg"
                        title={`Tag CY (${sheetColumns?.cyColumn}${parsed?.r}) only`}
                      >
                        CY
                      </button>
                      {sheetColumns?.pyColumn && (
                        <button
                          onClick={(e) => { e.stopPropagation(); tag(h, 'PY') }}
                          className="rounded border border-border px-1 text-[10px] text-muted hover:text-fg"
                          title={`Tag PY (${sheetColumns?.pyColumn}${parsed?.r}) only`}
                        >
                          PY
                        </button>
                      )}
                    </>
                  ) : (
                    (['CY', 'PY'] as Scope[]).map((s) => (
                      <button
                        key={s}
                        onClick={(e) => { e.stopPropagation(); tag(h, s) }}
                        className="rounded border border-border px-1 text-[10px] text-muted hover:text-fg"
                      >
                        {s}
                      </button>
                    ))
                  )}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-muted">
              <span className="font-mono">{h.qname}</span>
              <span>{h.dataType}</span>
              {h.periodType && <span>{h.periodType}</span>}
              {h.balance && <span>{h.balance}</span>}
              {h.elrCodes.length > 0 && <span>[{h.elrCodes.slice(0, 3).join(', ')}]</span>}
              {!h.nonDimensional && <span className="text-warn">table only</span>}
            </div>
          </li>
        ))}
        {query.trim().length >= 2 && hits.length === 0 && <li className="px-3 py-4 text-center text-xs text-muted">No elements match.</li>}
      </ul>
    </div>
  )
}
