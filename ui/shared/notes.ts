/** Note editor (docs/14 Step 6): F2 on a text element, paste from Word / Excel, Auto format, Word documents. */

/** What the editor opens: a text block (rich text, MCA subset) or a text item (plain text). CY only. */
export interface NoteEditorView {
  concept: string
  label: string
  /** 'textBlock' = rich text saved as MCA markup; 'string' = plain text */
  dataType: 'textBlock' | 'string'
  /** the current CY value as editor HTML ('' when empty) */
  html: string
  /** the text block this item sits directly under, when there is one */
  parent: { concept: string; label: string; empty: boolean } | null
}

export interface NoteLayoutView {
  blank: number
  shaded: number
  largeHeadings: number
  columns: number
  rows: number
  wideTables: number
}

/** The live "will it render in the MCA PDF" check. */
export interface NoteCheckView {
  renders: boolean
  errors: string[]
  warnings: string[]
  layout: NoteLayoutView
}

export interface NoteCheckInput {
  html: string
  dataType: NoteEditorView['dataType']
}

export interface AutoFormatView {
  html: string
  stats: { blank: number; columns: number; rows: number; moved: number }
}

export interface SaveNoteInput {
  concept: string
  /** editor HTML; empty clears the CY value */
  html: string
}

export interface SaveNoteResult {
  /** e.g. the parent text block is still empty */
  warnings: string[]
}

/** A Word document opened as a notes view: its blocks (paragraphs, headings, lists, tables) as editor HTML. */
export interface NoteDocument {
  id: string
  fileName: string
  blocks: string[]
  /** what the conversion could not keep (images, unknown styles …) */
  messages: string[]
}

/** One line of the editor's status: what the layout report means for the MCA PDF ('' when nothing to say). */
export function layoutHints(l: NoteLayoutView): string[] {
  const hints: [number, string][] = [
    [l.blank, 'empty paragraphs (large gaps in the PDF)'],
    [l.shaded, 'bold / italic / underlined runs (printed as shaded boxes)'],
    [l.largeHeadings, 'large headings'],
    [l.columns, 'empty table columns'],
    [l.rows, 'empty table rows'],
    [l.wideTables, 'tables with long text in 3+ columns (may be cut off at the page edge)'],
  ]
  return hints.filter(([n]) => n > 0).map(([n, text]) => `${n} ${text}`)
}
