import { create } from 'zustand'
import type { AppSettings, SettingsState } from '@shared/project'
import { unwrap } from '@/lib/result'
import { toast } from './toast'

interface SettingsStore {
  state: SettingsState | null
  init(): () => void
  update(patch: Partial<AppSettings>): Promise<void>
  /** returns a validation message, or null on success */
  setGroqKey(key: string): Promise<string | null>
  clearGroqKey(): Promise<void>
  pickMcaTool(): Promise<void>
}

const api = () => window.xap.settings

export const useSettings = create<SettingsStore>((set) => ({
  state: null,
  init: () => {
    if (!window.xap) return () => {}
    void api().get().then((state) => set({ state }))
    return api().onChanged((state) => set({ state }))
  },
  update: async (patch) => {
    const state = await unwrap(api().update(patch))
    if (state) set({ state })
  },
  setGroqKey: async (key) => {
    let problem: string | null = null
    const state = await unwrap(api().setGroqKey(key), { onValidation: (p) => (problem = p[0] ?? 'Invalid key') })
    if (state) {
      set({ state })
      toast.success('Groq API key saved (encrypted). Restarting the AI engine…')
    }
    return problem
  },
  clearGroqKey: async () => {
    const state = await unwrap(api().clearGroqKey())
    if (state) set({ state })
  },
  pickMcaTool: async () => {
    const state = await unwrap(api().pickMcaTool())
    if (state) set({ state })
  },
}))
