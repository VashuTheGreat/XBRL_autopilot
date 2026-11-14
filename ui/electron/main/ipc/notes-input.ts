/** IPC input validation for the note editor (docs/14 Step 6): shapes and sizes only; the service checks meaning. */
import type { NoteCheckInput, SaveNoteInput } from '@shared/notes'
import { requireString } from './handle'

/** A note is at most a long Directors' report with its tables. */
const MAX_HTML = 5_000_000
const DATA_TYPES = new Set(['textBlock', 'string'])

export function requireNoteHtml(v: unknown): string {
  if (typeof v !== 'string' || v.length > MAX_HTML) throw new Error('Invalid note')
  return v
}

export function requireNoteCheckInput(input: unknown): NoteCheckInput {
  const i = (input ?? {}) as Record<string, unknown>
  if (!DATA_TYPES.has(i.dataType as string)) throw new Error('Invalid data type')
  return { html: requireNoteHtml(i.html), dataType: i.dataType as NoteCheckInput['dataType'] }
}

export function requireSaveNoteInput(input: unknown): SaveNoteInput {
  const i = (input ?? {}) as Record<string, unknown>
  return { concept: requireString(i.concept, 'concept'), html: requireNoteHtml(i.html) }
}
