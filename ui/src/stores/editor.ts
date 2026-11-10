/**
 * Editor state: workbooks, tags (mappings), XBRL Form / XML views and the Excel ⟷ XBRL linkage.
 * Source of truth stays in main; this store caches read-models and refreshes when the project revision changes.
 */
import { create } from 'zustand'
import type { FormView, MappingView, Scope, XmlView } from '@shared/editor'
import { cellKey, type CellRef, type WorkbookModel } from '@shared/workbook'
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
}

const api = () => window.xap.editor
let revealSeq = 0

const index = (mappings: MappingView[]) => ({
  mappings,
  byCell: new Map(mappings.map((m) => [cellKey(m.cell), m])),
  byFact: new Map(mappings.filter((m) => m.factKey).map((m) => [m.factKey!, m])),
})

const EMPTY = {
  workbooks: [],
  activeSource: null,
  mappings: [],
  byCell: new Map<string, MappingView>(),
  byFact: new Map<string, MappingView>(),
  selection: { cell: null, factKey: null },
  reveal: null,
  form: null,
  xml: null,
  loadedRevision: -1,
  busy: false,
}

export const useEditor = create<EditorState>((set, get) => {
  const loadForm = async () => {
    const uri = get().activeElr
    if (!uri) return
    const form = await unwrap(api().form(uri), { quiet: true })
    if (form) set({ form })
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
      await Promise.all([loadForm(), get().xmlWanted ? loadXml() : Promise.resolve()])
    },

    importWorkbook: async (path) => {
      set({ busy: true })
      const wb = await unwrap(api().importWorkbook(path))
      set({ busy: false })
      if (wb) {
        set((s) => ({ workbooks: [...s.workbooks, wb], activeSource: wb.source }))
        toast.success(`Imported ${wb.fileName} (${wb.sheets.length} sheets)`)
      }
    },

    setActiveSource: (source) => set({ activeSource: source }),

    selectCell: (cell) => {
      const cur = get().selection.cell
      if (cur && cellKey(cur) === cellKey(cell)) return
      const m = get().byCell.get(cellKey(cell))
      set({ selection: { cell, factKey: m?.factKey ?? null } })
    },

    selectFact: (factKey) => {
      const m = factKey ? get().byFact.get(factKey) : undefined
      set({ selection: { cell: m?.cell ?? null, factKey } })
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
  }
})
