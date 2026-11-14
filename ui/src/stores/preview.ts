/** Preview tab (docs/14 Step 7): the rendered preview of the open filing and its format settings; main renders. */
import { create } from 'zustand'
import type { PreviewDocument, PreviewFormat } from '@shared/preview'
import { unwrap } from '@/lib/result'
import { toast } from './toast'

interface PreviewState {
  doc: PreviewDocument | null
  loading: boolean
  exporting: boolean
  load(): Promise<void>
  setFormat(patch: Partial<PreviewFormat>): Promise<void>
  exportPdf(): Promise<void>
  reset(): void
}

const api = () => window.xap.preview

export const usePreview = create<PreviewState>((set, get) => ({
  doc: null,
  loading: false,
  exporting: false,

  load: async () => {
    set({ loading: true })
    const doc = await unwrap(api().document(), { onValidation: (p) => toast.error(p.join(' ')) })
    set({ loading: false, ...(doc ? { doc } : {}) })
  },

  setFormat: async (patch) => {
    const doc = await unwrap(api().setFormat(patch), { onValidation: (p) => toast.error(p.join(' ')) })
    if (doc) set({ doc })
  },

  exportPdf: async () => {
    if (get().exporting) return
    set({ exporting: true })
    const r = await unwrap(api().exportPdf(), { onValidation: (p) => toast.error(p.join(' ')) })
    set({ exporting: false })
    if (r) toast.success(`PDF saved: ${r.path} (${Math.max(1, Math.round(r.bytes / 1024))} KB)`)
  },

  reset: () => set({ doc: null, loading: false, exporting: false }),
}))
