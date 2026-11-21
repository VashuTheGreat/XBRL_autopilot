/** Renderer state of the Ind AS pipeline screen (docs/17). The work happens in main / the sidecar. */
import { create } from 'zustand'
import type { GenerateXmlResult, MasterFields, Signatory, TransformResult } from '@shared/indas'
import { acceptTopSuggestions, buildGenerateInput, prefillMasters, rowsFromTransform, suggestionKey, type FilingMeta, type TagRow } from '@/features/indas/model'
import { unwrap } from '@/lib/result'
import { toast } from './toast'

export type IndasStep = 'financials' | 'tagging' | 'masters' | 'generate'

interface IndasState {
  open: boolean
  step: IndasStep
  /** what is running ('Converting…'), null when idle */
  busy: string | null
  progress: { done: number; total: number } | null
  transform: TransformResult | null
  rows: TagRow[]
  fields: MasterFields | null
  meta: FilingMeta
  company: Record<string, string>
  auditor: Record<string, string>
  signatories: Signatory[]
  result: GenerateXmlResult | null

  openPipeline(): void
  closePipeline(): void
  setStep(step: IndasStep): void
  saveTemplate(): Promise<void>
  /** no path → file dialog */
  upload(path?: string): Promise<void>
  suggest(): Promise<void>
  acceptTop(): void
  setConcept(id: string, concept: string): void
  loadFields(): Promise<void>
  setMeta(patch: Partial<FilingMeta>): void
  setCompany(qname: string, value: string): void
  setAuditor(qname: string, value: string): void
  addSignatory(): void
  updateSignatory(index: number, patch: Partial<Signatory>): void
  removeSignatory(index: number): void
  generate(): Promise<void>
}

const api = () => window.xap.indas
const thisFy = (): FilingMeta => {
  const now = new Date()
  const endYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return { nature: 'Standalone', startDate: `${endYear - 1}-04-01`, endDate: `${endYear}-03-31` }
}
const blankSignatory = (): Signatory => ({ din: '', name: '', designation: 'Director' })

const initial = () => ({
  step: 'financials' as IndasStep,
  busy: null,
  progress: null,
  transform: null,
  rows: [],
  meta: thisFy(),
  company: {},
  auditor: {},
  signatories: [blankSignatory(), blankSignatory()],
  result: null,
})

export const useIndas = create<IndasState>((set, get) => {
  const run = async (label: string, fn: () => Promise<void>) => {
    if (get().busy) return
    set({ busy: label })
    try {
      await fn()
    } finally {
      set({ busy: null, progress: null })
    }
  }

  return {
    open: false,
    fields: null,
    ...initial(),

    openPipeline: () => set({ open: true }),
    closePipeline: () => set({ open: false, ...initial() }),
    setStep: (step) => {
      set({ step })
      if (step === 'masters') void get().loadFields()
    },

    saveTemplate: () =>
      run('Preparing the template…', async () => {
        const path = await unwrap(api().saveTemplate())
        if (path) toast.success(`Template saved: ${path}`)
      }),

    upload: (path) =>
      run('Converting the workbook…', async () => {
        const t = await unwrap(api().transform(path))
        if (!t) return
        set({ transform: t, rows: rowsFromTransform(t), result: null })
        toast.success(t.source === 'standard_template' ? `Read ${t.fileName} (standard template)` : `Converted ${t.fileName}: review the rows`)
      }),

    suggest: () =>
      run('Suggesting tags…', async () => {
        const todo = get().rows.filter((r) => r.suggestions.length === 0)
        if (todo.length === 0) return
        const off = api().onProgress((p) => set({ progress: p }))
        try {
          const found = await unwrap(api().recommend(todo.map(suggestionKey)))
          if (!found) return
          const byId = new Map(todo.map((r, i) => [r.id, found[i] ?? []]))
          set({ rows: get().rows.map((r) => (byId.has(r.id) ? { ...r, suggestions: byId.get(r.id)! } : r)) })
        } finally {
          off()
        }
      }),

    acceptTop: () => set({ rows: acceptTopSuggestions(get().rows) }),
    setConcept: (id, concept) => set({ rows: get().rows.map((r) => (r.id === id ? { ...r, concept } : r)) }),

    loadFields: async () => {
      const fields = get().fields ?? (await unwrap(api().masterFields()))
      if (!fields) return
      const { meta, company, auditor } = get()
      set({ fields, company: prefillMasters(fields.company, meta, company), auditor: prefillMasters(fields.auditor, meta, auditor) })
    },

    setMeta: (patch) => {
      const meta = { ...get().meta, ...patch }
      const f = get().fields
      // the period / nature fields follow the filing settings
      set({ meta, company: f ? prefillMasters(f.company, meta, dropKnown(get().company)) : get().company })
    },
    setCompany: (q, v) => set({ company: { ...get().company, [q]: v } }),
    setAuditor: (q, v) => set({ auditor: { ...get().auditor, [q]: v } }),
    addSignatory: () => set({ signatories: [...get().signatories, blankSignatory()] }),
    updateSignatory: (i, patch) => set({ signatories: get().signatories.map((s, j) => (j === i ? { ...s, ...patch } : s)) }),
    removeSignatory: (i) => set({ signatories: get().signatories.filter((_, j) => j !== i) }),

    generate: () =>
      run('Validating and generating the XML…', async () => {
        const s = get()
        const result = await unwrap(api().generate(buildGenerateInput(s)))
        if (!result) return
        set({ result })
        if (result.ok) toast.success(`XML saved: ${result.fileName}`)
      }),
  }
})

/** Removes the values prefillMasters owns, so they are recomputed from the new filing settings. */
function dropKnown(company: Record<string, string>): Record<string, string> {
  const owned = /:(DateOfStartOfReportingPeriod|DateOfEndOfReportingPeriod|NatureOfReportStandaloneConsolidated)$/
  return Object.fromEntries(Object.entries(company).filter(([k]) => !owned.test(k)))
}
