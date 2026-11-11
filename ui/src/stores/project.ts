/** Renderer view of the open filing + the use cases the UI triggers. All state lives in main. */
import { create } from 'zustand'
import type { ElrInfo, ImportReportView, InstanceImportMode, NewFilingInput, ProjectSummary, RecentProject, RecoveryItem } from '@shared/project'
import { unwrap } from '@/lib/result'
import { toast } from './toast'

interface ProjectState {
  summary: ProjectSummary | null
  recent: RecentProject[]
  recovery: RecoveryItem[]
  elrs: ElrInfo[]
  /** project id the ELR list belongs to (each project may use another taxonomy) */
  elrsFor: string | null
  newFilingOpen: boolean
  importXbrlOpen: boolean
  /** shown after an XBRL instance import */
  importReport: ImportReportView | null
  init(): () => void
  refreshLists(): Promise<void>
  openNewFiling(): void
  closeNewFiling(): void
  /** returns form problems on validation failure, [] on success */
  create(input: NewFilingInput): Promise<string[]>
  open(path?: string): Promise<void>
  openImportXbrl(): void
  closeImportXbrl(): void
  /** a filing from an existing XBRL instance (file dialog in main) */
  importXbrl(mode: InstanceImportMode, path?: string): Promise<void>
  closeImportReport(): void
  save(): Promise<void>
  saveAs(): Promise<void>
  close(): Promise<void>
  recover(id: string): Promise<void>
  discardRecovery(id: string): Promise<void>
  forgetRecent(path: string): Promise<void>
  /** "decimal places as presented"; tagged figures are re-pulled from Excel */
  setStatementPlaces(places: number): Promise<void>
}

const api = () => window.xap.project

export const useProject = create<ProjectState>((set, get) => {
  const loadElrs = async (summary: ProjectSummary | null) => {
    if (!summary) return set({ elrs: [], elrsFor: null })
    if (get().elrsFor === summary.id) return
    set({ elrs: [], elrsFor: summary.id })
    const elrs = await unwrap(api().elrs())
    if (elrs && get().elrsFor === summary.id) set({ elrs })
  }
  const afterOpen = async (s: ProjectSummary | null | undefined, verb: string) => {
    if (!s) return
    set({ summary: s })
    await Promise.all([loadElrs(s), get().refreshLists()])
    if (s.readOnlyReason) toast.info(s.readOnlyReason)
    else toast.success(`${verb} ${s.company.name} · ${s.fyLabel}`)
  }

  return {
    summary: null,
    recent: [],
    recovery: [],
    elrs: [],
    elrsFor: null,
    newFilingOpen: false,
    importXbrlOpen: false,
    importReport: null,

    init: () => {
      if (!window.xap) return () => {}
      void api().current().then((summary) => {
        set({ summary })
        void loadElrs(summary)
      })
      void get().refreshLists()
      return api().onChanged((summary) => {
        set({ summary })
        void loadElrs(summary)
      })
    },

    refreshLists: async () => {
      const [recent, recovery] = await Promise.all([api().recent(), api().recovery()])
      set({ recent, recovery })
    },

    openNewFiling: () => set({ newFilingOpen: true }),
    closeNewFiling: () => set({ newFilingOpen: false }),

    create: async (input) => {
      let problems: string[] = []
      const s = await unwrap(api().create(input), { onValidation: (p) => (problems = p) })
      if (problems.length) return problems
      if (s) {
        set({ newFilingOpen: false })
        await afterOpen(s, 'Created')
      }
      return []
    },

    open: async (path) => afterOpen(await unwrap(api().open(path)), 'Opened'),

    openImportXbrl: () => set({ importXbrlOpen: true }),
    closeImportXbrl: () => set({ importXbrlOpen: false }),
    importXbrl: async (mode, path) => {
      const res = await unwrap(api().importXbrl(mode, path))
      if (!res) return
      set({ importXbrlOpen: false, importReport: res.report })
      await afterOpen(res.summary, mode === 'next' ? 'Started next year for' : 'Imported')
    },
    closeImportReport: () => set({ importReport: null }),

    save: async () => {
      const s = await unwrap(api().save())
      if (s) {
        toast.success(`Saved ${s.fileName}`)
        await get().refreshLists()
      }
    },

    saveAs: async () => {
      const s = await unwrap(api().saveAs())
      if (s) {
        toast.success(`Saved ${s.fileName}`)
        await get().refreshLists()
      }
    },

    close: async () => {
      if (await unwrap(api().close())) {
        set({ summary: null, elrs: [], elrsFor: null })
        await get().refreshLists()
      }
    },

    recover: async (id) => afterOpen(await unwrap(api().recover(id)), 'Recovered'),

    discardRecovery: async (id) => {
      await api().discardRecovery(id)
      await get().refreshLists()
    },

    forgetRecent: async (path) => {
      await api().forgetRecent(path)
      await get().refreshLists()
    },

    setStatementPlaces: async (places) => {
      const kept = await unwrap(api().setStatementPlaces(places), { onValidation: (p) => toast.error(p.join(' ')) })
      if (!kept) return
      if (kept.length) toast.error(`Decimal places set to ${places}; ${kept.length} tag(s) kept their old value: ${kept.join(' ')}`)
      else toast.success(`Decimal places as presented: ${places}. Tagged figures were re-read from Excel.`)
    },
  }
})
