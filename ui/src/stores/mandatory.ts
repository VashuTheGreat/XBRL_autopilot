/**
 * Mandatory text / date / Yes-No items (docs/14 Step 5) and the Generate flow: the read-models from main, refreshed
 * while a dialog is open; writes go to main (engine fact patch) and come back through the project revision.
 */
import { create } from 'zustand'
import type { GenerateResult, KeyAnswerView, MandatoryView, SetMandatoryInput } from '@shared/mandatory'
import { unwrap } from '@/lib/result'
import { toast } from './toast'

interface MandatoryStore {
  listOpen: boolean
  generateOpen: boolean
  view: MandatoryView | null
  keyAnswers: KeyAnswerView[]
  generating: boolean
  openList(): void
  closeList(): void
  openGenerate(): void
  closeGenerate(): void
  /** reloads what an open dialog shows (after any change to the filing) */
  refresh(): Promise<void>
  /** writes one item; returns false (and shows why) when the value is refused */
  set(input: SetMandatoryInput): Promise<boolean>
  generate(): Promise<GenerateResult | null>
}

const api = () => window.xap.mandatory

export const useMandatory = create<MandatoryStore>((set, get) => ({
  listOpen: false,
  generateOpen: false,
  view: null,
  keyAnswers: [],
  generating: false,

  openList: () => {
    set({ listOpen: true })
    void get().refresh()
  },
  closeList: () => set({ listOpen: false }),
  openGenerate: () => {
    set({ generateOpen: true })
    void get().refresh()
  },
  closeGenerate: () => set({ generateOpen: false }),

  refresh: async () => {
    if (!get().listOpen && !get().generateOpen) return
    const [view, keyAnswers] = await Promise.all([unwrap(api().list(), { quiet: true }), get().generateOpen ? unwrap(api().keyAnswers(), { quiet: true }) : Promise.resolve(get().keyAnswers)])
    set({ ...(view ? { view } : {}), keyAnswers: keyAnswers ?? [] })
  },

  set: async (input) => {
    const r = await api().set(input)
    if (!r.ok) {
      toast.error(r.error.kind === 'validation' ? r.error.problems.join(' ') : r.error.message)
      return false
    }
    await get().refresh()
    return true
  },

  generate: async () => {
    set({ generating: true })
    const r = await unwrap(api().generate(), { onValidation: (p) => toast.error(p.join(' ')) })
    set({ generating: false })
    if (r) {
      toast.success(`XML generated: ${r.xmlPath}`)
      set({ generateOpen: false })
    }
    return r ?? null
  },
}))
