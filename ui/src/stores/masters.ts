/**
 * Masters panel (docs/14 Step 9): the read-model from main, reloaded when the project revision changes; writes go to
 * main (the filing's facts, the master library). A new grid row lives here until its first cell is written: a typed
 * member exists in the filing only once it has a value.
 */
import { create } from 'zustand'
import type { FillFromMasterInput, MasterRowRef, MastersView, SaveMasterInput, SetMasterCellInput, SetMasterItemInput } from '@shared/masters'
import type { Result } from '@shared/ipc'
import { unwrap } from '@/lib/result'
import { toast } from './toast'

interface MastersStore {
  view: MastersView | null
  /** tableId → members of rows added here and not written yet */
  pending: Record<string, string[]>
  refresh(): Promise<void>
  setItem(input: SetMasterItemInput): Promise<boolean>
  setCell(input: SetMasterCellInput): Promise<boolean>
  addRow(tableId: string): Promise<void>
  removeRow(ref: MasterRowRef): Promise<void>
  fill(input: FillFromMasterInput): Promise<void>
  save(input: SaveMasterInput): Promise<void>
  forget(id: string): Promise<void>
}

const api = () => window.xap.masters
const showProblems = (p: string[]) => toast.error(p.join(' '))

export const useMasters = create<MastersStore>((set, get) => {
  /** runs a write; on success reloads the view (the project revision also moves, for the Form) */
  const write = async (call: Promise<Result<unknown>>): Promise<boolean> => {
    const r = await call
    if (!r.ok) {
      showProblems(r.error.kind === 'validation' ? r.error.problems : [r.error.message])
      return false
    }
    await get().refresh()
    return true
  }
  const dropPending = (tableId: string, member: string) =>
    set((s) => ({ pending: { ...s.pending, [tableId]: (s.pending[tableId] ?? []).filter((m) => m !== member) } }))

  return {
    view: null,
    pending: {},

    refresh: async () => {
      const view = await unwrap(api().view(), { quiet: true })
      set({ view: view ?? null })
    },

    setItem: (input) => write(api().setItem(input)),

    setCell: async (input) => {
      const ok = await write(api().setCell(input))
      if (ok && input.value.trim()) dropPending(input.tableId, input.member)
      return ok
    },

    addRow: async (tableId) => {
      const member = await unwrap(api().newRow(tableId))
      if (!member) return
      // the main process suggests the next member from the filing: a second unsaved row needs its own number
      const taken = new Set(get().pending[tableId] ?? [])
      const unique = taken.has(member) ? nextFree(member, taken) : member
      set((s) => ({ pending: { ...s.pending, [tableId]: [...(s.pending[tableId] ?? []), unique] } }))
    },

    removeRow: async (ref) => {
      dropPending(ref.tableId, ref.member)
      await write(api().removeRow(ref))
    },

    fill: async (input) => {
      const r = await unwrap(api().fill(input), { onValidation: showProblems })
      if (!r) return
      toast.success(r.added ? `Filled ${r.added} row${r.added === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} already there)` : ''}.` : 'Already there: nothing to add.')
      await get().refresh()
    },

    save: async (input) => {
      const r = await unwrap(api().save(input), { onValidation: showProblems })
      if (r) toast.success(`Saved to the master library: ${r.title}`)
      await get().refresh()
    },

    forget: async (id) => {
      await write(api().forget(id))
    },
  }
})

/** The member after `member` in its numbering that no pending row uses (Auditors02 → Auditors03). */
function nextFree(member: string, taken: Set<string>): string {
  const m = /^(.*?)(\d+)$/.exec(member)
  const [stem, digits] = m ? [m[1]!, m[2]!] : [member, '1']
  for (let n = Number(digits) + 1; ; n++) {
    const candidate = `${stem}${String(n).padStart(digits.length, '0')}`
    if (!taken.has(candidate)) return candidate
  }
}
