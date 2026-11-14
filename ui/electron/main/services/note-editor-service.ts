/**
 * NoteEditorService (docs/14 Step 6): the F2 note editor and the Word notes view over the open filing. Thin over the
 * engine (notes.ts on core/richtext.js): opens a text element's CY value as editor HTML, checks and Auto-formats what
 * the user pasted, saves it as the fact (MCA markup for a text block, plain text for a string; CY only — text blocks
 * are current-year only), and converts a .docx into selectable blocks. Electron-free.
 */
import {
  applyFactPatch,
  autoFormatNote,
  checkNote,
  documentBlocks,
  NOTE_TYPES,
  noteForEditor,
  noteValue,
  nondimAllowed,
  parentTextBlock,
  type Session,
} from '@xap/engine'
import type { AutoFormatView, NoteCheckInput, NoteCheckView, NoteDocument, NoteEditorView, SaveNoteInput, SaveNoteResult } from '@shared/notes'
import { engineProblems, ValidationError } from './errors'
import type { DocxConverter, ProjectAccess } from './ports'

type Authority = Parameters<typeof parentTextBlock>[0] & { has(q: string): boolean }

export class NoteEditorService {
  private documents = 0

  constructor(
    private readonly projects: ProjectAccess,
    private readonly docx: DocxConverter,
  ) {}

  open(concept: string): NoteEditorView {
    const { A, session } = this.context()
    const dataType = this.noteType(A, concept)
    if (!nondimAllowed(A as never, concept)) throw new ValidationError([`${A.label(concept)} is reported inside a table: edit it in the table.`])
    return { concept, label: A.label(concept), dataType, html: noteForEditor(valueOf(session, concept)), parent: this.parent(A, session, concept) }
  }

  check(input: NoteCheckInput): NoteCheckView {
    const { renders, errors, warnings, layout } = checkNote(input.html, input.dataType)
    return { renders, errors, warnings, layout }
  }

  /** Pasted or typed HTML reduced to what a text block can hold, as editor HTML (paste from Word / Excel). */
  clean(html: string): string {
    return noteForEditor(noteValue(html, 'textBlock'))
  }

  autoFormat(html: string): AutoFormatView {
    return autoFormatNote(html)
  }

  /** Writes the CY value (empty clears it); refused when it would not render in the MCA PDF. */
  save(input: SaveNoteInput): SaveNoteResult {
    const p = this.projects.project()
    const A = p.authority.authority as unknown as Authority
    const session = p.session as Session
    const dataType = this.noteType(A, input.concept)
    const check = checkNote(input.html, dataType)
    if (!check.renders) throw new ValidationError(check.errors)
    try {
      if (check.value.trim()) applyFactPatch(session, { op: 'setText', fact: { concept: input.concept, scope: 'CY' }, value: check.value, source: { kind: 'user' } })
      else (session as unknown as { setValue(q: string, s: 'CY', v: string): unknown }).setValue(input.concept, 'CY', '')
    } catch (err) {
      throw new ValidationError(engineProblems(err))
    }
    p.touch()
    const parent = this.parent(A, session, input.concept)
    return { warnings: check.value.trim() && parent?.empty ? [`Its parent text block "${parent.label}" is still empty: tag it too.`] : [] }
  }

  /** A Word document as a notes view: its blocks, each selectable and taggable as a text block. */
  async openDocx(fileName: string, bytes: Uint8Array): Promise<NoteDocument> {
    let converted: { html: string; messages: string[] }
    try {
      converted = await this.docx.toHtml(bytes)
    } catch (err) {
      throw new ValidationError([`${fileName} could not be read as a Word document (.docx): ${err instanceof Error ? err.message : String(err)}`])
    }
    return { id: `doc-${++this.documents}`, fileName, blocks: documentBlocks(converted.html), messages: converted.messages }
  }

  private noteType(A: Authority, concept: string): NoteEditorView['dataType'] {
    if (!A.has(concept)) throw new ValidationError(['That element is not part of this taxonomy.'])
    const t = A.dataType(concept)
    if (!NOTE_TYPES.has(t)) throw new ValidationError([`The note editor edits text blocks and text items; ${A.label(concept)} is ${t === 'monetary' ? 'an amount' : `a ${t}`}.`])
    return t as NoteEditorView['dataType']
  }

  private parent(A: Authority, session: Session, concept: string): NoteEditorView['parent'] {
    const q = parentTextBlock(A, concept)
    return q ? { concept: q, label: A.label(q), empty: !valueOf(session, q) } : null
  }

  private context() {
    const p = this.projects.project()
    return { A: p.authority.authority as unknown as Authority, session: p.session as Session }
  }
}

function valueOf(session: Session, q: string): string | null {
  const f = (session as unknown as { getValue(q: string, s: 'CY'): { value: string; nil?: boolean } | null }).getValue(q, 'CY')
  return f && !f.nil ? f.value : null
}
