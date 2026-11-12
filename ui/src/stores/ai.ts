import { create } from 'zustand'
import type { AiHistoryEntry, AiPatchCard, AiView } from '@shared/ai'
import type { Problem } from '@shared/validation'
import { unwrap } from '@/lib/result'
import { useEditor } from './editor'
import { toast } from './toast'
import { useUi } from './ui'

interface AiStore {
  view: AiView | null
  history: AiHistoryEntry[] | null
  historyOpen: boolean
  init(): () => void
  ask(p: Problem): Promise<void>
  fixAll(): Promise<void>
  stop(): Promise<void>
  accept(card: AiPatchCard, opts?: { input?: string; confirmed?: boolean }): Promise<boolean>
  reject(card: AiPatchCard, reason?: string): Promise<void>
  clear(): Promise<void>
  locate(card: AiPatchCard): Promise<void>
  toggleHistory(): Promise<void>
}

const api = () => window.xap.ai
const onValidation = { onValidation: (m: string[]) => toast.error(m.join(' ')) }

export const useAi = create<AiStore>((set, get) => {
  /** pushes and replies race: keep the newest */
  const show = (view: AiView | undefined | null) => {
    if (!view) return
    const cur = get().view
    if (!cur || view.revision >= cur.revision) set({ view })
  }
  const refreshHistory = async () => {
    if (get().historyOpen) set({ history: (await unwrap(api().history())) ?? [] })
  }
  return {
    view: null,
    history: null,
    historyOpen: false,

    init: () => {
      if (!window.xap) return () => {}
      void api().get().then(show)
      return api().onChanged(show)
    },

    ask: async (p) => {
      useUi.getState().setBottomTab('ai')
      show(await unwrap(api().propose(p.id), onValidation))
      void refreshHistory()
    },

    fixAll: async () => {
      useUi.getState().setBottomTab('ai')
      show(await unwrap(api().fixAll(), onValidation))
    },

    stop: async () => show(await unwrap(api().stop())),

    accept: async (card, opts) => {
      const view = await unwrap(api().accept(card.id, opts), onValidation)
      void refreshHistory()
      if (!view) return false
      show(view)
      toast.success(`Applied: ${card.title}`)
      return true
    },

    reject: async (card, reason) => {
      show(await unwrap(api().reject(card.id, reason), onValidation))
      void refreshHistory()
    },

    clear: async () => show(await unwrap(api().clear())),

    locate: async (card) => {
      const editor = useEditor.getState()
      if (card.elrUri) {
        useUi.getState().setRightTab('form')
        if (editor.activeElr !== card.elrUri) await editor.setActiveElr(card.elrUri)
      }
      if (card.factKey) editor.selectFact(card.factKey)
      if (card.cell) {
        editor.revealCell(card.cell)
        editor.selectCell(card.cell)
      }
    },

    toggleHistory: async () => {
      const open = !get().historyOpen
      set({ historyOpen: open })
      if (open) await refreshHistory()
    },
  }
})

/** Cards still waiting for a decision. */
export function openCards(view: AiView | null): AiPatchCard[] {
  return view?.proposals.flatMap((p) => p.cards).filter((c) => c.status === 'proposed') ?? []
}
