/**
 * Several sources per fact (docs/14 Step 3, ADR-0015): the Add / Replace / Cancel question asked when a tag would
 * write a fact that already has a value, and the View details dialog. Data comes from main; this store only holds
 * what is open.
 */
import { create } from 'zustand'
import type { MappingDetails, TagConflict, TagMode } from '@shared/editor'
import { unwrap } from '@/lib/result'
import { toast } from './toast'

interface SourcesState {
  /** the open Add / Replace question */
  conflict: TagConflict | null
  /** asks Add / Replace / Cancel; resolves null on Cancel */
  ask(conflict: TagConflict): Promise<TagMode | null>
  answer(mode: TagMode | null): void
  /** the tag whose View details is open */
  details: MappingDetails | null
  openDetails(mappingId: string): Promise<void>
  closeDetails(): void
  removeSource(index: number): Promise<void>
  saveFootnote(): Promise<void>
}

const api = () => window.xap.editor
let resolveAsk: ((mode: TagMode | null) => void) | null = null

export const useSources = create<SourcesState>((set, get) => ({
  conflict: null,
  details: null,

  ask: (conflict) => {
    resolveAsk?.(null) // one question at a time: a newer one cancels the older
    set({ conflict })
    return new Promise((resolve) => (resolveAsk = resolve))
  },

  answer: (mode) => {
    resolveAsk?.(mode)
    resolveAsk = null
    set({ conflict: null })
  },

  openDetails: async (mappingId) => {
    const details = await unwrap(api().mappingDetails(mappingId), { onValidation: (p) => toast.error(p.join(' ')) })
    if (details) set({ details })
  },

  closeDetails: () => set({ details: null }),

  removeSource: async (index) => {
    const d = get().details
    if (!d) return
    const r = await api().removeSource(d.mappingId, index)
    if (!r.ok) return void toast.error(r.error.message)
    if (r.value === null) {
      set({ details: null })
      toast.success(`Untagged ${d.conceptLabel} (${d.scope}): its last source was removed.`)
      return
    }
    await get().openDetails(d.mappingId)
  },

  saveFootnote: async () => {
    const d = get().details
    if (!d) return
    const r = await unwrap(api().saveSourcesFootnote(d.mappingId), { onValidation: (p) => toast.error(p.join(' ')) })
    if (r) toast.success(`Footnote ${r.footnoteId} on ${d.conceptLabel} (${d.scope}): ${r.text}`)
  },
}))
