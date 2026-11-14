/**
 * Note editor (docs/14 Step 6): the F2 editor's target and the Word documents opened as notes views. Content checks,
 * Auto format and saving go to main (engine notes.ts); the documents live here for the session (not saved in .axbrl).
 */
import { create } from 'zustand'
import type { NoteDocument, NoteEditorView } from '@shared/notes'
import { unwrap } from '@/lib/result'
import { toast } from './toast'

/** What F2 opened: an element (its value), or a text cell not tagged yet (its text, an element still to choose). */
export type NoteTarget = { kind: 'element'; view: NoteEditorView; initialHtml: string | null } | { kind: 'choose'; initialHtml: string }

interface NotesStore {
  target: NoteTarget | null
  documents: NoteDocument[]
  activeDoc: string | null
  /** indexes of the selected blocks of the active document */
  selected: number[]
  /** opens the editor on an element; `initialHtml` (a cell's text) replaces an empty value */
  openElement(concept: string, initialHtml?: string | null): Promise<void>
  /** opens the editor on a text cell that has no element yet */
  openChooser(initialHtml: string): void
  close(): void
  /** saves; returns false when refused (the editor stays open) */
  save(concept: string, html: string): Promise<boolean>
  openDocx(): Promise<void>
  showDoc(id: string | null): void
  closeDoc(id: string): void
  /** click = select one block; with `extend` (Ctrl / Shift) add or remove it */
  selectBlock(index: number, extend: boolean): void
  /** the selected blocks of the active document, as one HTML ('' when none) */
  selectedHtml(): string
  /** tags the selected blocks as the element (double-click in the Taxonomy panel) */
  tagSelected(concept: string): Promise<void>
}

const api = () => window.xap.notes
const showProblems = (p: string[]) => toast.error(p.join(' '))

export const useNotes = create<NotesStore>((set, get) => ({
  target: null,
  documents: [],
  activeDoc: null,
  selected: [],

  openElement: async (concept, initialHtml = null) => {
    const view = await unwrap(api().open(concept), { onValidation: showProblems })
    if (view) set({ target: { kind: 'element', view, initialHtml: view.html ? null : initialHtml } })
  },

  openChooser: (initialHtml) => set({ target: { kind: 'choose', initialHtml } }),

  close: () => set({ target: null }),

  save: async (concept, html) => {
    const r = await unwrap(api().save({ concept, html }), { onValidation: showProblems })
    if (!r) return false
    for (const w of r.warnings) toast.error(w)
    if (!r.warnings.length) toast.success('Saved.')
    return true
  },

  openDocx: async () => {
    const doc = await unwrap(api().openDocx(), { onValidation: showProblems })
    if (!doc) return
    if (doc.messages.length) toast.error(`${doc.fileName}: ${doc.messages.length} item(s) could not be kept (e.g. ${doc.messages[0]}).`)
    set((s) => ({ documents: [...s.documents, doc], activeDoc: doc.id, selected: [] }))
  },

  showDoc: (id) => set({ activeDoc: id, selected: [] }),

  closeDoc: (id) =>
    set((s) => {
      const documents = s.documents.filter((d) => d.id !== id)
      return { documents, activeDoc: s.activeDoc === id ? (documents[0]?.id ?? null) : s.activeDoc, selected: [] }
    }),

  selectBlock: (index, extend) =>
    set((s) => ({ selected: !extend ? [index] : s.selected.includes(index) ? s.selected.filter((i) => i !== index) : [...s.selected, index].sort((a, b) => a - b) })),

  selectedHtml: () => {
    const { documents, activeDoc, selected } = get()
    const doc = documents.find((d) => d.id === activeDoc)
    return doc ? selected.map((i) => doc.blocks[i] ?? '').join('') : ''
  },

  tagSelected: async (concept) => {
    const html = get().selectedHtml()
    if (html && (await get().save(concept, html))) set({ selected: [] })
  },
}))
