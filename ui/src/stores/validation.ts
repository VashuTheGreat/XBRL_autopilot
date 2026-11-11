import { create } from 'zustand'
import type { Problem, ProblemSeverity, ValidationView } from '@shared/validation'
import { unwrap } from '@/lib/result'
import { useEditor } from './editor'
import { toast } from './toast'
import { useUi } from './ui'

export type SourceFilter = 'all' | 'engine' | 'mca'

interface ValidationStore {
  view: ValidationView | null
  severities: Record<ProblemSeverity, boolean>
  source: SourceFilter
  /** a problem selected in the panel (keyboard / single click) */
  selected: string | null
  pasteOpen: boolean
  init(): () => void
  run(): Promise<void>
  fix(p: Problem): Promise<void>
  locate(p: Problem): Promise<void>
  select(id: string | null): void
  toggleSeverity(s: ProblemSeverity): void
  setSource(s: SourceFilter): void
  setPasteOpen(open: boolean): void
  importMcaText(text: string): Promise<boolean>
  importMcaFile(): Promise<void>
  clearMca(): Promise<void>
  launchMca(): Promise<void>
}

const api = () => window.xap.validation

export const useValidation = create<ValidationStore>((set, get) => {
  /** a newer run may already be shown (pushes and replies race): keep the newest */
  const show = (view: ValidationView | undefined | null) => {
    if (!view) return
    const cur = get().view
    if (!cur || view.revision >= cur.revision) set({ view })
  }
  return {
    view: null,
    severities: { error: true, warning: true, info: false },
    source: 'all',
    selected: null,
    pasteOpen: false,

    init: () => {
      if (!window.xap) return () => {}
      void api().get().then(show)
      return api().onChanged(show)
    },

    run: async () => show(await unwrap(api().run())),

    fix: async (p) => {
      const view = await unwrap(api().fix(p.id), { onValidation: (m) => toast.error(m.join(' ')) })
      if (view) {
        show(view)
        toast.success(`Fixed: ${p.fix?.label ?? 'applied'}`)
      }
    },

    locate: async (p) => {
      set({ selected: p.id })
      const editor = useEditor.getState()
      const loc = p.location
      if (loc?.elrUri) {
        useUi.getState().setRightTab('form')
        if (editor.activeElr !== loc.elrUri) await editor.setActiveElr(loc.elrUri)
      }
      if (loc?.factKey) editor.selectFact(loc.factKey) // also reveals the Excel cell when the fact came from one
      if (p.cell) {
        editor.revealCell(p.cell)
        editor.selectCell(p.cell)
      }
      if (!loc?.elrUri && !p.cell) toast.info('This problem concerns the whole filing; it has no cell or statement row.')
    },

    select: (id) => set({ selected: id }),
    toggleSeverity: (s) => set((st) => ({ severities: { ...st.severities, [s]: !st.severities[s] } })),
    setSource: (source) => set({ source }),
    setPasteOpen: (pasteOpen) => set({ pasteOpen }),

    importMcaText: async (text) => {
      const view = await unwrap(api().importMca(text), { onValidation: (m) => toast.error(m.join(' ')) })
      if (!view) return false
      show(view)
      set({ source: 'mca', pasteOpen: false })
      toast.success(`${view.mca?.count ?? 0} MCA error(s) imported and explained.`)
      return true
    },

    importMcaFile: async () => {
      const view = await unwrap(api().importMca(), { onValidation: (m) => toast.error(m.join(' ')) })
      if (!view) return
      show(view)
      set({ source: 'mca' })
      toast.success(`${view.mca?.count ?? 0} MCA error(s) imported and explained.`)
    },

    clearMca: async () => {
      show(await unwrap(api().clearMca()))
      set({ source: 'all' })
    },

    launchMca: async () => {
      const r = await unwrap(api().launchMca(), { onValidation: (m) => toast.error(m.join(' ')) })
      if (!r) return
      toast.info(
        `${r.validated ? '' : 'Written with open errors (marked NOT VALIDATED). '}In the MCA tool: choose the taxonomy, File → Open ${r.xmlPath}, then Validate. ` +
          'Copy its error list back with Problems → Import MCA errors.',
      )
    },
  }
})

/** The problems the panel shows, after the severity and source filters. */
export function visibleProblems(view: ValidationView | null, severities: Record<ProblemSeverity, boolean>, source: SourceFilter): Problem[] {
  if (!view) return []
  return view.problems.filter((p) => severities[p.severity] && (source === 'all' || p.source === source))
}

/** Problems grouped by statement / note (in order of first appearance); "Filing" for those without one. */
export function groupByStatement(problems: Problem[]): { key: string; title: string; problems: Problem[] }[] {
  const groups = new Map<string, { key: string; title: string; problems: Problem[] }>()
  for (const p of problems) {
    const key = p.location?.elrUri ?? (p.source === 'mca' ? 'mca' : 'filing')
    const title = p.location?.elrTitle
      ? `${p.location.elrCode ? `[${p.location.elrCode}] ` : ''}${p.location.elrTitle}`
      : p.source === 'mca' ? 'MCA Validation Tool' : 'Filing'
    if (!groups.has(key)) groups.set(key, { key, title, problems: [] })
    groups.get(key)!.problems.push(p)
  }
  return [...groups.values()]
}
