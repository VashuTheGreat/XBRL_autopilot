/**
 * Table tagging in the renderer (ADR-0013): the taxonomy's tables, their structures (cached per project), and which
 * dialog is open — "Map as table" for a dragged range (or a suggested block to review), or "Also report as" for a
 * tagged cell — and the accept / reject of auto-tagging's suggested blocks.
 * Source of truth stays in main; this store only caches read-models.
 */
import { create } from 'zustand'
import type { BlockSuggestion, TableBlockInput, TableBlockPlan, TableBlockResult, TableInfo, TableStructure } from '@shared/editor'
import type { CellRef } from '@shared/workbook'
import { unwrap } from '@/lib/result'
import { toast } from './toast'

export type TableDialog =
  | { kind: 'map'; range: CellRef; suggestion?: BlockSuggestion }
  | { kind: 'also'; mappingId: string; concept: string }
  | null

interface TablesState {
  catalog: TableInfo[] | null
  structures: Record<string, TableStructure>
  dialog: TableDialog
  reset(): void
  loadCatalog(): Promise<TableInfo[]>
  structure(tableId: string): Promise<TableStructure | null>
  open(d: Exclude<TableDialog, null>): void
  close(): void
  plan(input: TableBlockInput): Promise<TableBlockPlan | null>
  apply(input: TableBlockInput): Promise<TableBlockResult | null>
  /** applies a suggested block, as suggested or as edited in the dialog */
  acceptBlock(id: string, edited?: TableBlockInput): Promise<TableBlockResult | null>
  rejectBlock(id: string): Promise<void>
}

const api = () => window.xap.editor
const onValidation = (p: string[]) => toast.error(p.join(' '))

/** Says what applying a block tagged (and what it left untagged). */
function report(r: TableBlockResult | undefined): TableBlockResult | null {
  if (!r) return null
  if (r.tagged) toast.success(`Tagged ${r.tagged} table cell${r.tagged === 1 ? '' : 's'}${r.problems.length ? `; ${r.problems.length} left untagged` : ''}.`)
  else toast.error(`Nothing was tagged: ${r.problems.slice(0, 2).map((p) => `${p.cell.ref}: ${p.problems[0]}`).join('; ')}`)
  return r
}

export const useTables = create<TablesState>((set, get) => ({
  catalog: null,
  structures: {},
  dialog: null,

  reset: () => set({ catalog: null, structures: {}, dialog: null }),

  loadCatalog: async () => {
    const have = get().catalog
    if (have) return have
    const catalog = (await unwrap(api().tables(), { quiet: true })) ?? []
    set({ catalog })
    return catalog
  },

  structure: async (tableId) => {
    const have = get().structures[tableId]
    if (have) return have
    const s = await unwrap(api().tableStructure(tableId), { onValidation })
    if (s) set((st) => ({ structures: { ...st.structures, [tableId]: s } }))
    return s ?? null
  },

  open: (d) => set({ dialog: d }),
  close: () => set({ dialog: null }),

  plan: (input) => unwrap(api().planTable(input), { onValidation }).then((x) => x ?? null),

  apply: async (input) => report(await unwrap(api().applyTable(input), { onValidation })),

  acceptBlock: async (id, edited) => report(await unwrap(api().acceptBlock(id, edited), { onValidation })),

  rejectBlock: async (id) => {
    await unwrap(api().rejectBlock(id), { onValidation })
  },
}))

