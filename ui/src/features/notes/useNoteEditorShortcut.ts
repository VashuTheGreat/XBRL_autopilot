import { useEffect } from 'react'
import { cellValueAt } from '@shared/workbook'
import { useEditor } from '@/stores/editor'
import { useNotes } from '@/stores/notes'
import { toast } from '@/stores/toast'

/**
 * F2 opens the note editor (docs/14 Step 6) on what the user last pointed at: an element row of the Form (any element
 * carrying `data-concept`), else the selected Excel cell — its element when it is tagged, else its text with an
 * element to choose. No change to the Form or the grid: the Form's rows already carry their element.
 */
export function useNoteEditorShortcut(): void {
  useEffect(() => {
    let pointed: string | null = null
    const onPointer = (e: PointerEvent) => {
      pointed = (e.target as Element | null)?.closest?.('[data-concept]')?.getAttribute('data-concept') ?? null
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F2' || e.ctrlKey || e.altKey || e.metaKey || useNotes.getState().target) return
      e.preventDefault()
      const notes = useNotes.getState()
      if (pointed) return void notes.openElement(pointed)
      const { selection, workbooks } = useEditor.getState()
      const text = selection.cell ? cellValueAt(workbooks, selection.cell) : null
      const html = typeof text === 'string' && text.trim() ? text : null
      if (selection.concept) return void notes.openElement(selection.concept, html)
      if (html) return notes.openChooser(html)
      toast.error('F2 edits a text block: click its line in the Form, or a text cell in Excel.')
    }
    window.addEventListener('pointerdown', onPointer, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onPointer, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [])
}
