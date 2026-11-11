/**
 * Editor state: workbooks, tags (mappings), XBRL Form / XML views and the Excel ⟷ XBRL linkage.
 * Source of truth stays in main; this store caches read-models and refreshes when the project revision changes.
 */
import { create } from 'zustand'
import type { CellInfo, FormView, MappingView, Scope, XmlView } from '@shared/editor'
import { cellKey, rangeCells, type CellRef, type WorkbookModel } from '@shared/workbook'
import { unwrap } from '@/lib/result'
import { toast } from './toast'

export interface Selection {
  cell: CellRef | null
  factKey: string | null
}

interface EditorState {
  workbooks: WorkbookModel[]
  activeSource: string | null
  mappings: MappingView[]
  byCell: Map<string, MappingView>
  byFact: Map<string, MappingView>
  selection: Selection
  /** amount + column period of the selected cell (inspector) */
  cellInfo: CellInfo | null
  /** a request for the Excel pane to show a cell; `seq` changes on every request */
  reveal: { cell: CellRef; seq: number } | null
  activeElr: string | null
  form: FormView | null
  xml: XmlView | null
  xmlWanted: boolean
  loadedRevision: number
  busy: boolean

  reset(): void
  sync(revision: number, sourceCount: number): Promise<void>
  importWorkbook(path?: string): Promise<void>
  setActiveSource(source: string): void
  selectCell(cell: CellRef): void
  selectFact(factKey: string | null): void
  revealCell(cell: CellRef): void
  setActiveElr(uri: string): Promise<void>
  setXmlWanted(wanted: boolean): Promise<void>
  /** tags the selected cell; returns false when nothing happened */
  tagSelected(concept: string, scope?: Scope): Promise<boolean>
  untag(id: string): Promise<void>
  setScope(id: string, scope: Scope): Promise<void>
  /** reports the active statement's empty mandatory amounts as 0 */
  fillMandatoryZeros(): Promise<void>
  /** remembers the period of the selected cell's column (null forgets it) */
  setColumnPeriod(scope: Scope | null): Promise<void>
  /** an auto-tagging run is in progress */
  autoTagging: boolean
  /** auto-tags every imported workbook: stores suggestions, writes no fact */
  autoTag(): Promise<void>
  acceptSuggestion(id: string, concept?: string): Promise<void>
  rejectSuggestion(id: string): Promise<void>
  /** accepts every suggestion with confidence ≥ min */
  acceptAllSuggestions(min: number): Promise<void>
}

const api = () => window.xap.editor
let revealSeq = 0

const index = (mappings: MappingView[]) => ({
  mappings,
  // keyed by the mapping's own reference and by every cell a summed range covers
  byCell: new Map(mappings.flatMap((m) => [[cellKey(m.cell), m] as const, ...rangeCells(m.cell.ref).map((a1) => [cellKey({ ...m.cell, ref: a1 }), m] as const)])),
  byFact: new Map(mappings.filter((m) => m.factKey).map((m) => [m.factKey!, m])),
})

const EMPTY = {
  workbooks: [],
  activeSource: null,
  mappings: [],
  byCell: new Map<string, MappingView>(),
  byFact: new Map<string, MappingView>(),
  selection: { cell: null, factKey: null },
  cellInfo: null,
  reveal: null,
  form: null,
  xml: null,
  loadedRevision: -1,
  busy: false,
  autoTagging: false,
}

export const useEditor = create<EditorState>((set, get) => {
  const loadForm = async () => {
    const uri = get().activeElr
    if (!uri) return
    const form = await unwrap(api().form(uri), { quiet: true })
    if (form) set({ form })
  }
  const loadCellInfo = async () => {
    const cell = get().selection.cell
    if (!cell) return set({ cellInfo: null })
    const info = await unwrap(api().cellInfo(cell), { quiet: true })
    // a newer selection may have arrived meanwhile
    if (get().selection.cell === cell) set({ cellInfo: info ?? null })
  }
  const loadXml = async () => {
    const xml = await unwrap(api().xml(), { quiet: true })
    if (xml) set({ xml })
  }

  return {
    ...EMPTY,
    activeElr: null,
    xmlWanted: false,

    reset: () => set({ ...EMPTY, activeElr: null }),

    sync: async (revision, sourceCount) => {
      if (revision === get().loadedRevision) return
      set({ loadedRevision: revision })
      const needWorkbooks = get().workbooks.length !== sourceCount
      const [workbooks, mappings] = await Promise.all([
        needWorkbooks ? unwrap(api().workbooks(), { quiet: true }) : Promise.resolve(get().workbooks),
        unwrap(api().mappings(), { quiet: true }),
      ])
      if (workbooks) set({ workbooks, activeSource: get().activeSource ?? workbooks[0]?.source ?? null })
      if (mappings) set(index(mappings))
      await Promise.all([loadForm(), loadCellInfo(), get().xmlWanted ? loadXml() : Promise.resolve()])
    },

    importWorkbook: async (path) => {
      set({ busy: true })
      const wb = await unwrap(api().importWorkbook(path))
      set({ busy: false })
      if (wb) {
        // the revision sync may already have fetched it: keep one entry per source
        set((s) => ({ workbooks: [...s.workbooks.filter((w) => w.source !== wb.source), wb], activeSource: wb.source }))
        toast.success(`Imported ${wb.fileName} (${wb.sheets.length} sheets)`)
        const cut = wb.sheets.filter((s) => s.truncated)
        if (cut.length) {
          toast.info(
            `Very large sheet${cut.length > 1 ? 's' : ''} shown in part: ${cut.map((s) => `“${s.name}” (first ${s.truncated!.keptRows.toLocaleString('en-IN')} rows of ${s.truncated!.totalCells.toLocaleString('en-IN')} cells)`).join(', ')}.`,
          )
        }
      }
    },

    setActiveSource: (source) => set({ activeSource: source }),

    selectCell: (cell) => {
      const cur = get().selection.cell
      if (cur && cellKey(cur) === cellKey(cell)) return
      const m = get().byCell.get(cellKey(cell))
      set({ selection: { cell, factKey: m?.factKey ?? null }, cellInfo: null })
      void loadCellInfo()
    },

    selectFact: (factKey) => {
      const m = factKey ? get().byFact.get(factKey) : undefined
      set({ selection: { cell: m?.cell ?? null, factKey }, cellInfo: null })
      void loadCellInfo()
      if (m) get().revealCell(m.cell)
    },

    revealCell: (cell) => set({ reveal: { cell, seq: ++revealSeq }, activeSource: cell.workbook }),

    setActiveElr: async (uri) => {
      set({ activeElr: uri })
      await loadForm()
    },

    setXmlWanted: async (wanted) => {
      set({ xmlWanted: wanted })
      if (wanted) await loadXml()
    },

    tagSelected: async (concept, scope) => {
      const cell = get().selection.cell
      if (!cell) {
        toast.info('Select a cell in the Excel pane first, then double-click the element.')
        return false
      }
      const m = await unwrap(api().tag({ cell, concept, ...(scope ? { scope } : {}) }), {
        onValidation: (p) => toast.error(p.join(' ')),
      })
      if (!m) return false
      set({ selection: { cell, factKey: m.factKey } })
      toast.success(`${cell.sheet}!${cell.ref} → ${m.conceptLabel} (${m.fact.scope})`)
      return true
    },

    untag: async (id) => {
      const r = await api().untag(id)
      if (!r.ok) toast.error(r.error.message)
      else set((s) => ({ selection: { ...s.selection, factKey: null } }))
    },

    setScope: async (id, scope) => {
      const m = await unwrap(api().setScope(id, scope), { onValidation: (p) => toast.error(p.join(' ')) })
      if (m) set((s) => ({ selection: { ...s.selection, factKey: m.factKey } }))
    },

    fillMandatoryZeros: async () => {
      const uri = get().activeElr
      if (!uri) return
      const filled = await unwrap(api().fillMandatoryZeros(uri), { onValidation: (p) => toast.error(p.join(' ')) })
      if (!filled) return
      if (!filled.length) toast.info('No empty mandatory amounts in this statement.')
      else toast.success(`Reported as 0: ${filled.map((z) => `${z.label} (${z.scope})`).join(', ')}`)
    },

    setColumnPeriod: async (scope) => {
      const cell = get().selection.cell
      if (!cell) return
      const col = await unwrap(api().setColumnPeriod(cell, scope), { onValidation: (p) => toast.error(p.join(' ')) })
      if (col && get().selection.cell === cell) set((s) => ({ cellInfo: s.cellInfo && { ...s.cellInfo, column: col } }))
    },

    autoTag: async () => {
      if (get().autoTagging) return
      set({ autoTagging: true })
      const summary = await unwrap(api().autoTag(), { onValidation: (p) => toast.error(p.join(' ')) })
      set({ autoTagging: false })
      if (!summary) return
      const statements = summary.sheets.filter((s) => s.rows > 0).length
      if (!summary.suggested) {
        toast.info(summary.skipped ? `Nothing new to suggest: ${summary.skipped} cells are already tagged or were rejected.` : 'No taggable rows found: no column header names this filing’s year ends.')
        return
      }
      toast.success(
        `${summary.suggested} suggestions on ${statements} sheet${statements === 1 ? '' : 's'} (amber cells)${summary.llmUsed ? ', AI-reranked' : ''}. Nothing is tagged until you accept.`,
      )
    },

    acceptSuggestion: async (id, concept) => {
      const m = await unwrap(api().acceptSuggestion(id, concept), { onValidation: (p) => toast.error(p.join(' ')) })
      if (m) set({ selection: { cell: m.cell, factKey: m.factKey } })
    },

    rejectSuggestion: async (id) => {
      await unwrap(api().rejectSuggestion(id), { onValidation: (p) => toast.error(p.join(' ')) })
    },

    acceptAllSuggestions: async (min) => {
      const r = await unwrap(api().acceptAllSuggestions(min), { onValidation: (p) => toast.error(p.join(' ')) })
      if (!r) return
      if (r.accepted) toast.success(`Tagged ${r.accepted} suggested cell${r.accepted === 1 ? '' : 's'} (confidence ≥ ${Math.round(min * 100)}%).`)
      else if (!r.problems.length) toast.info(`No suggestions at ≥ ${Math.round(min * 100)}% confidence.`)
      if (r.problems.length) toast.error(`${r.problems.length} could not be tagged and stay suggested: ${r.problems.slice(0, 3).join('; ')}${r.problems.length > 3 ? '…' : ''}`)
    },
  }
})
