import { Check, Copy, ExternalLink, HelpCircle, Info, Layers, Loader2, MousePointerClick, Search, Sparkles, Tag, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { formatIndian } from '@xap/engine/basics'
import type { ConceptHit, MappingView, Scope } from '@shared/editor'
import { cellKey, columnLetter, fromA1, rangeOf } from '@shared/workbook'
import { Button, Dialog } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { unwrap } from '@/lib/result'
import { useEditor } from '@/stores/editor'
import { toast } from '@/stores/toast'

/**
 * ManualTagDialog: Professional XBRL tagging modal triggered by double-clicking
 * a financial statement line item or value cell.
 *
 * Supports:
 * - Direct taxonomy concept search by element name, label, or description
 * - Detailed inspection (dataType, periodType, balance, statement ELRs)
 * - Period scope assignment (Both CY & PY, CY only, PY only)
 * - Clear manual tagging state (approved manual vs AI suggestion vs not tagged)
 * - Coexistence with AI recommendations (view confidence, rationale, alternatives, 1-click accept)
 * - Remove / untag existing tags
 */
export function ManualTagDialog() {
  const {
    manualTagOpen,
    manualTagTarget,
    closeManualTag,
    selection,
    byCell,
    workbooks,
    sheetColumns,
    tagSelected,
    untag,
    acceptSuggestion,
    rejectSuggestion,
  } = useEditor()

  const cell = manualTagTarget?.cell ?? selection.cell
  const parsed = cell ? fromA1(cell.ref) : null
  const currentCol = parsed ? columnLetter(parsed.c) : null
  const rowNum = parsed ? parsed.r + 1 : undefined
  const cyCol = sheetColumns?.cyColumn
  const pyCol = sheetColumns?.pyColumn

  // WebXBRL row label / particulars detection
  const isParticulars = !!(
    parsed &&
    currentCol &&
    cyCol &&
    currentCol !== cyCol &&
    (!pyCol || currentCol !== pyCol)
  )

  // Retrieve raw workbook cell value and row particulars label
  const { rawVal, rowLabel } = useMemo(() => {
    if (!cell) return { rawVal: null, rowLabel: '' }
    const at = rangeOf(cell.ref)
    const sheet = workbooks.find((w) => w.source === cell.workbook)?.sheets.find((s) => s.name === cell.sheet)
    if (!sheet || !at) return { rawVal: null, rowLabel: '' }

    const raw = sheet.cells.find((c) => c.r === at.r1 && c.c === at.c1)?.v ?? null

    let label = manualTagTarget?.label ?? ''
    if (!label) {
      if (typeof raw === 'string' && isNaN(Number(raw.replace(/[,\s]/g, '')))) {
        label = raw.trim()
      } else {
        const rowCells = sheet.cells.filter((c) => c.r === at.r1)
        const bCell = rowCells.find((c) => c.c === 1 && typeof c.v === 'string')
        const textCell = bCell ?? rowCells.find((c) => typeof c.v === 'string' && isNaN(Number(c.v.replace(/[,\s]/g, ''))))
        if (textCell && typeof textCell.v === 'string') {
          label = textCell.v.trim()
        }
      }
    }
    return { rawVal: raw, rowLabel: label }
  }, [cell, manualTagTarget, workbooks])

  // Look for existing tag or suggestion
  const { directMapping, cyMapping, pyMapping, activeMapping } = useMemo(() => {
    if (!cell) return { directMapping: null, cyMapping: null, pyMapping: null, activeMapping: null }
    const direct = byCell.get(cellKey(cell)) ?? null
    const cy = isParticulars && cyCol && rowNum ? byCell.get(cellKey({ ...cell, ref: `${cyCol}${rowNum}` })) ?? null : null
    const py = isParticulars && pyCol && rowNum ? byCell.get(cellKey({ ...cell, ref: `${pyCol}${rowNum}` })) ?? null : null
    const active = direct ?? cy ?? py ?? null
    return { directMapping: direct, cyMapping: cy, pyMapping: py, activeMapping: active }
  }, [cell, byCell, isParticulars, cyCol, pyCol, rowNum])

  // Dialog internal state
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ConceptHit[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedHit, setSelectedHit] = useState<ConceptHit | null>(null)
  const [scopeChoice, setScopeChoice] = useState<'Both' | 'CY' | 'PY'>('Both')
  const [submitting, setSubmitting] = useState(false)

  // Initialize query and scope whenever dialog opens or target changes
  useEffect(() => {
    if (!manualTagOpen) {
      setSelectedHit(null)
      return
    }

    if (isParticulars) {
      setScopeChoice('Both')
    } else {
      setScopeChoice(currentCol && pyCol && currentCol === pyCol ? 'PY' : 'CY')
    }

    // Determine initial search query
    const initialQuery = manualTagTarget?.concept
      ? manualTagTarget.concept.replace(/^[a-z0-9_-]+:/i, '')
      : rowLabel
        ? rowLabel
        : activeMapping
          ? activeMapping.conceptLabel
          : ''

    setQuery(initialQuery)

    // Trigger immediate initial search if query is non-empty
    if (initialQuery.trim().length >= 2) {
      setLoading(true)
      void unwrap(window.xap.editor.searchConcepts(initialQuery.trim()), { quiet: true })
        .then((res) => {
          setHits(res ?? [])
          if (res && res.length > 0) {
            // If target had a specific concept, highlight it
            if (manualTagTarget?.concept) {
              const exact = res.find((h) => h.qname === manualTagTarget.concept)
              if (exact) setSelectedHit(exact)
              else setSelectedHit(res[0])
            } else if (activeMapping) {
              const current = res.find((h) => h.qname === activeMapping.fact.concept)
              if (current) setSelectedHit(current)
              else setSelectedHit(res[0])
            } else {
              setSelectedHit(res[0])
            }
          }
        })
        .finally(() => setLoading(false))
    } else {
      setHits([])
    }
  }, [manualTagOpen, manualTagTarget, rowLabel, activeMapping, isParticulars, currentCol, pyCol])

  // Debounced concept search on typing
  useEffect(() => {
    if (!manualTagOpen) return
    const q = query.trim()
    if (q.length < 2) {
      setHits([])
      return
    }

    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await unwrap(window.xap.editor.searchConcepts(q), { quiet: true })
        setHits(res ?? [])
        if (res && res.length > 0) {
          // If previous selection is still in new hits, preserve it; otherwise pick first
          setSelectedHit((prev) => (prev && res.some((h) => h.qname === prev.qname) ? prev : res[0]))
        } else {
          setSelectedHit(null)
        }
      } catch {
        setHits([])
      } finally {
        setLoading(false)
      }
    }, 200)

    return () => clearTimeout(timer)
  }, [query, manualTagOpen])

  // Tagging handler
  const handleApplyTag = async (hitToApply?: ConceptHit) => {
    const hit = hitToApply ?? selectedHit
    if (!hit) {
      toast.info('Please select a taxonomy element first.')
      return
    }

    setSubmitting(true)
    try {
      let scopeArg: Scope | undefined = undefined
      if (isParticulars) {
        if (scopeChoice === 'CY') scopeArg = 'CY'
        else if (scopeChoice === 'PY') scopeArg = 'PY'
        // 'Both' leaves scopeArg undefined, which tagSelected handles by tagging both CY and PY
      } else {
        scopeArg = scopeChoice === 'PY' ? 'PY' : 'CY'
      }

      const ok = await tagSelected(hit.qname, scopeArg)
      if (ok) {
        closeManualTag()
      }
    } finally {
      setSubmitting(false)
    }
  }

  // Untag handler
  const handleUntag = async () => {
    setSubmitting(true)
    try {
      if (directMapping) {
        await untag(directMapping.id)
      }
      if (cyMapping && (!directMapping || cyMapping.id !== directMapping.id)) {
        await untag(cyMapping.id)
      }
      if (pyMapping && (!directMapping || pyMapping.id !== directMapping.id) && (!cyMapping || pyMapping.id !== cyMapping.id)) {
        await untag(pyMapping.id)
      }
      toast.info('Tag removed.')
      closeManualTag()
    } finally {
      setSubmitting(false)
    }
  }

  // Accept AI suggestion handler
  const handleAcceptAi = async (m: MappingView) => {
    setSubmitting(true)
    try {
      await acceptSuggestion(m.id)
      closeManualTag()
    } finally {
      setSubmitting(false)
    }
  }

  if (!cell) return null

  const isApproved = activeMapping?.status === 'approved'
  const isAiSuggested = activeMapping?.status === 'suggested'

  return (
    <Dialog open={manualTagOpen} onClose={closeManualTag} title="Manual XBRL Tagging" width={680}>
      <div className="flex flex-col gap-4 text-xs">
        {/* Context Strip: Target line item details */}
        <div className="rounded-lg border border-border bg-panel-2 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono font-medium text-fg">
                  {cell.sheet}!{cell.ref}
                </span>
                {isParticulars ? (
                  <span className="rounded bg-accent/15 px-1.5 py-0.5 font-sans text-[10px] font-medium text-accent">
                    Row Label (Row {rowNum})
                  </span>
                ) : (
                  <span className="rounded bg-panel px-1.5 py-0.5 font-mono text-[10px] text-muted border border-border">
                    Figure Cell
                  </span>
                )}
                {/* Tag status badge */}
                {isApproved && (
                  <span
                    className={cn(
                      'flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold',
                      activeMapping?.origin === 'manual'
                        ? 'bg-ok/20 text-ok border border-ok/30'
                        : 'bg-accent/20 text-accent border border-accent/30',
                    )}
                  >
                    <Check size={11} />
                    {activeMapping?.origin === 'manual' ? 'Manually Tagged' : `Approved (${activeMapping?.origin})`}
                  </span>
                )}
                {isAiSuggested && (
                  <span className="flex items-center gap-1 rounded bg-warn/20 text-warn border border-warn/30 px-2 py-0.5 text-[10px] font-semibold">
                    <Sparkles size={11} /> AI Suggestion
                  </span>
                )}
                {!activeMapping && (
                  <span className="rounded bg-muted/15 px-2 py-0.5 text-[10px] text-muted">
                    Not Tagged
                  </span>
                )}
              </div>

              {/* Line item text or figure */}
              <div className="mt-1.5 flex items-baseline gap-2">
                {rowLabel ? (
                  <p className="font-medium text-fg text-sm select-text">{rowLabel}</p>
                ) : (
                  <p className="text-muted italic">No text label on this row</p>
                )}
                {rawVal !== null && typeof rawVal === 'number' && (
                  <span className="font-mono text-xs text-muted tabular">
                    Value: {formatIndian(String(rawVal))}
                  </span>
                )}
              </div>
            </div>

            {/* Scope selector */}
            <div className="shrink-0 flex flex-col items-end gap-1">
              <span className="text-[10px] text-muted font-medium uppercase tracking-wider">Period Scope</span>
              {isParticulars ? (
                <div className="flex overflow-hidden rounded border border-border bg-panel">
                  <button
                    type="button"
                    onClick={() => setScopeChoice('Both')}
                    className={cn(
                      'px-2 py-1 text-[11px] font-medium transition-colors',
                      scopeChoice === 'Both' ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg',
                    )}
                    title={`Tag both CY (Col ${cyCol}) and PY (Col ${pyCol ?? ''})`}
                  >
                    Both (CY & PY)
                  </button>
                  <button
                    type="button"
                    onClick={() => setScopeChoice('CY')}
                    className={cn(
                      'border-l border-border px-2 py-1 text-[11px] font-medium transition-colors',
                      scopeChoice === 'CY' ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg',
                    )}
                    title={`Tag CY (Col ${cyCol}) only`}
                  >
                    CY
                  </button>
                  {pyCol && (
                    <button
                      type="button"
                      onClick={() => setScopeChoice('PY')}
                      className={cn(
                        'border-l border-border px-2 py-1 text-[11px] font-medium transition-colors',
                        scopeChoice === 'PY' ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg',
                      )}
                      title={`Tag PY (Col ${pyCol}) only`}
                    >
                      PY
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex overflow-hidden rounded border border-border bg-panel">
                  <button
                    type="button"
                    onClick={() => setScopeChoice('CY')}
                    className={cn(
                      'px-2.5 py-1 text-[11px] font-medium transition-colors',
                      scopeChoice === 'CY' ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg',
                    )}
                  >
                    CY
                  </button>
                  <button
                    type="button"
                    onClick={() => setScopeChoice('PY')}
                    className={cn(
                      'border-l border-border px-2.5 py-1 text-[11px] font-medium transition-colors',
                      scopeChoice === 'PY' ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg',
                    )}
                  >
                    PY
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Current Tag Display (if already tagged) */}
          {isApproved && activeMapping && (
            <div className="mt-2.5 flex items-center justify-between border-t border-border pt-2 text-[11px]">
              <div className="flex items-center gap-1.5 min-w-0">
                <Tag size={12} className="shrink-0 text-ok" />
                <span className="text-muted">Currently assigned:</span>
                <span className="font-semibold text-fg truncate">{activeMapping.conceptLabel}</span>
                <span className="font-mono text-[10px] text-muted">({activeMapping.fact.concept})</span>
              </div>
              <Button
                variant="ghost"
                className="h-6 shrink-0 px-2 text-[11px] text-err hover:bg-err/10"
                onClick={handleUntag}
                disabled={submitting}
                title="Remove this tag"
              >
                <Trash2 size={11} className="mr-1" /> Remove Tag
              </Button>
            </div>
          )}
        </div>

        {/* AI Recommendations Section (Coexistence with AI) */}
        {isAiSuggested && activeMapping && (
          <div className="rounded-lg border border-warn/40 bg-warn/10 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-warn shrink-0" />
                  <span className="text-xs font-semibold text-warn">AI Recommended Tag</span>
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.2 text-[10px] font-bold',
                      (activeMapping.confidence ?? 0) >= 0.9
                        ? 'bg-ok/20 text-ok'
                        : (activeMapping.confidence ?? 0) >= 0.6
                          ? 'bg-warn/20 text-warn'
                          : 'bg-err/20 text-err',
                    )}
                  >
                    {Math.round((activeMapping.confidence ?? 0) * 100)}% match
                  </span>
                </div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-xs font-semibold text-fg">{activeMapping.conceptLabel}</span>
                  <span className="font-mono text-[10px] text-muted">{activeMapping.fact.concept}</span>
                </div>
                {activeMapping.rationale && (
                  <p className="mt-1 text-[11px] text-muted italic">&ldquo;{activeMapping.rationale}&rdquo;</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  variant="primary"
                  className="h-7 px-3 text-xs"
                  onClick={() => handleAcceptAi(activeMapping)}
                  disabled={submitting}
                >
                  <Check size={12} className="mr-1" /> Accept AI Suggestion
                </Button>
                <Button
                  variant="ghost"
                  className="h-7 px-2 text-xs text-muted hover:text-err"
                  onClick={async () => {
                    await rejectSuggestion(activeMapping.id)
                  }}
                  disabled={submitting}
                  title="Dismiss AI suggestion"
                >
                  <X size={12} />
                </Button>
              </div>
            </div>

            {/* Runner-up suggestions */}
            {activeMapping.alternatives && activeMapping.alternatives.length > 0 && (
              <div className="mt-2.5 border-t border-warn/20 pt-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                  Runner-up alternatives:
                </span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {activeMapping.alternatives.map((alt) => (
                    <button
                      key={alt.concept}
                      type="button"
                      onClick={() => setQuery(alt.label)}
                      className="flex items-center gap-1 rounded border border-border bg-panel px-2 py-0.5 text-[11px] hover:border-accent hover:text-accent transition-colors"
                      title={`${alt.concept} (${Math.round(alt.score * 100)}%)`}
                    >
                      <span className="font-medium">{alt.label}</span>
                      <span className="text-[10px] text-muted">({Math.round(alt.score * 100)}%)</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Taxonomy Concept Search Bar */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="concept-search-input" className="text-xs font-medium text-fg flex items-center justify-between">
            <span>Search XBRL Taxonomy Element</span>
            <span className="text-[11px] font-normal text-muted">
              Double-click any element to assign immediately
            </span>
          </label>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-muted pointer-events-none" />
            <input
              id="concept-search-input"
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const hit = selectedHit ?? hits[0]
                  if (hit) void handleApplyTag(hit)
                }
              }}
              placeholder="Search elements by label, name, or description (e.g. Share Capital, Trade Receivables)..."
              className="h-9 w-full rounded-md border border-border bg-panel pl-8 pr-8 text-xs outline-none focus:border-accent select-text transition-colors"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-2.5 text-muted hover:text-fg"
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Search Results & Element Inspector Split View */}
        <div className="grid grid-cols-5 gap-3 h-64 min-h-64">
          {/* Left: Hits List (3 cols) */}
          <div className="col-span-3 flex flex-col rounded-md border border-border bg-panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-border bg-panel-2 px-3 py-1.5 text-[11px] text-muted">
              <span>Matching Concepts ({hits.length})</span>
              {loading && <Loader2 size={12} className="animate-spin text-accent" />}
            </div>
            <div className="flex-1 overflow-auto p-1" role="listbox" aria-label="Taxonomy concepts">
              {hits.length > 0 ? (
                hits.map((h) => {
                  const isSelected = selectedHit?.qname === h.qname
                  return (
                    <div
                      key={h.qname}
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => setSelectedHit(h)}
                      onDoubleClick={() => void handleApplyTag(h)}
                      className={cn(
                        'group flex cursor-pointer flex-col gap-0.5 rounded px-2.5 py-1.5 transition-colors',
                        isSelected ? 'bg-accent/15 text-accent' : 'hover:bg-panel-2 text-fg',
                        !h.nonDimensional && 'opacity-65',
                      )}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="font-semibold text-xs leading-snug">{h.label}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {!h.nonDimensional && (
                            <span className="rounded bg-warn/15 px-1 font-mono text-[9px] text-warn">
                              table only
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleApplyTag(h)
                            }}
                            className="hidden group-hover:flex items-center gap-1 rounded bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-fg hover:bg-accent/90 transition-colors"
                            title="Tag this element immediately"
                          >
                            <Tag size={10} /> Tag
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-[10px] text-muted">
                        <span className="truncate">{h.qname}</span>
                        {h.periodType && <span>· {h.periodType}</span>}
                        {h.balance && <span>· {h.balance}</span>}
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="flex h-full flex-col items-center justify-center p-4 text-center text-muted">
                  {loading ? (
                    <div className="flex items-center gap-2 text-xs">
                      <Loader2 size={14} className="animate-spin text-accent" />
                      <span>Searching taxonomy...</span>
                    </div>
                  ) : query.trim().length < 2 ? (
                    <p className="text-xs">Type at least 2 characters to search taxonomy elements.</p>
                  ) : (
                    <div className="flex flex-col items-center gap-1">
                      <HelpCircle size={20} className="text-muted/60" />
                      <p className="text-xs">No elements found matching &ldquo;{query}&rdquo;.</p>
                      <p className="text-[11px] text-muted/70">Try using broader search terms or synonyms.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right: Selected Concept Inspector (2 cols) */}
          <div className="col-span-2 flex flex-col rounded-md border border-border bg-panel-2 p-3 overflow-auto">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Element Inspector
            </span>

            {selectedHit ? (
              <div className="mt-2 flex flex-col gap-2.5">
                <div>
                  <h4 className="font-semibold text-sm text-fg leading-tight">{selectedHit.label}</h4>
                  <div className="mt-1 flex items-center gap-1">
                    <span className="font-mono text-[10px] text-muted select-text break-all">
                      {selectedHit.qname}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(selectedHit.qname)
                        toast.info('Copied QName to clipboard.')
                      }}
                      className="shrink-0 text-muted hover:text-fg p-0.5"
                      title="Copy QName"
                    >
                      <Copy size={11} />
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5 border-t border-border/60 pt-2 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-muted">Data Type:</span>
                    <span className="font-mono font-medium text-fg">{selectedHit.dataType}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Period Type:</span>
                    <span className="font-medium text-fg capitalize">{selectedHit.periodType ?? '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Normal Balance:</span>
                    <span className={cn('font-medium capitalize', selectedHit.balance ? 'text-fg' : 'text-muted')}>
                      {selectedHit.balance ?? 'None'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Form Structure:</span>
                    <span className={cn('font-medium', selectedHit.nonDimensional ? 'text-ok' : 'text-warn')}>
                      {selectedHit.nonDimensional ? 'Plain line item' : 'Table/Dimension only'}
                    </span>
                  </div>
                </div>

                {selectedHit.elrCodes.length > 0 && (
                  <div className="border-t border-border/60 pt-2 text-[11px]">
                    <span className="text-muted">Appears in Statements:</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {selectedHit.elrCodes.map((code) => (
                        <span
                          key={code}
                          className="rounded bg-panel px-1.5 py-0.5 font-mono text-[10px] text-muted border border-border"
                        >
                          [{code}]
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-auto pt-2">
                  <Button
                    variant="primary"
                    className="w-full text-xs"
                    onClick={() => void handleApplyTag(selectedHit)}
                    disabled={submitting}
                  >
                    <Check size={12} className="mr-1.5" /> Tag This Element
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center text-muted">
                <Info size={18} className="text-muted/60 mb-1" />
                <p className="text-xs">Select an element to inspect its taxonomy properties.</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-border pt-3">
          <div className="flex items-center gap-2 text-[11px] text-muted">
            <MousePointerClick size={13} />
            <span>Double-click or press Enter on any element to tag immediately</span>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={closeManualTag} disabled={submitting}>
              Close
            </Button>
            {selectedHit && (
              <Button
                variant="primary"
                onClick={() => void handleApplyTag(selectedHit)}
                disabled={submitting}
              >
                <Check size={13} className="mr-1" /> Tag Element
              </Button>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  )
}
