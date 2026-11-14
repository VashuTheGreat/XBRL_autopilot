/**
 * Note editor (docs/14 Step 6): the engine side of F2, pasted Word / Excel content and Word documents. No sanitiser of
 * its own — core/richtext.js converts (toMca / fromMca / tidy / blocks) and core/gate.js says what the MCA HTML schema
 * rejects (htmlGuidelineIssues); this module composes them:
 *   noteForEditor / noteValue   a fact's value ↔ the editor's HTML (text blocks carry MCA markup, strings plain text)
 *   checkNote                   the live "will it render in the MCA PDF" check: schema problems + layout report
 *   autoFormatNote              "Auto format": pasted tables rebuilt on a grid, empty rows / columns / paragraphs dropped,
 *                               long text moved into one column — text is never removed
 *   documentBlocks              a converted document's top-level blocks, the units a notes view selects
 *   parentTextBlock             the text block a sub-item sits directly under (taxonomy presentation)
 *   noteStructureIssues         a text sub-item reported without its parent text block (INFO)
 * Text blocks are current-year only: the note editor writes CY (an MCA-accepted instance may still carry a PY one, so
 * that is not reported).
 */
import { htmlGuidelineIssues } from './core/gate.js'
import { blocks, fromMca, layoutReport, plainText, tidy, toMca } from './core/richtext.js'
import type { Session } from './core/session.js'

export interface NoteLayout {
  blank: number
  shaded: number
  largeHeadings: number
  columns: number
  rows: number
  wideTables: number
}

export interface NoteCheck {
  /** the value that would be saved (MCA markup for a text block) */
  value: string
  /** what the MCA HTML schema rejects: the MCA tool / PDF would fail */
  errors: string[]
  /** accepted, but may print badly or be rejected */
  warnings: string[]
  /** what prints untidily in the MCA PDF (empty paragraphs, shaded runs, large headings, wide tables …) */
  layout: NoteLayout
  /** no errors: it renders in the MCA PDF */
  renders: boolean
}

export interface AutoFormatResult {
  html: string
  stats: { blank: number; columns: number; rows: number; moved: number }
}

/** Element data types the note editor edits: rich text for text blocks, plain text for strings. */
export const NOTE_TYPES = new Set(['textBlock', 'string'])

/** A fact's stored value as the editor shows it. */
export function noteForEditor(value: string | null | undefined): string {
  return fromMca(value ?? '')
}

/** The editor's HTML as the fact stores it: MCA markup for a text block, the visible text for a string. */
export function noteValue(editorHtml: string, dataType: string): string {
  return dataType === 'textBlock' ? toMca(editorHtml) : plainText(editorHtml)
}

/** Whether the content renders in the MCA PDF, and what would print untidily. */
export function checkNote(editorHtml: string, dataType = 'textBlock'): NoteCheck {
  const value = noteValue(editorHtml, dataType)
  const { errors, warnings } = dataType === 'textBlock' ? (htmlGuidelineIssues(value, { detail: true }) as { errors: string[]; warnings: string[] }) : { errors: [], warnings: [] }
  return { value, errors, warnings, layout: layoutReport(editorHtml) as NoteLayout, renders: errors.length === 0 }
}

/** "Auto format" of pasted content: tables normalised to the MCA grid, empty paragraphs / rows / columns dropped. */
export function autoFormatNote(editorHtml: string): AutoFormatResult {
  const { html, stats } = tidy(editorHtml, { style: 'keep', wideTables: true }) as { html: string; stats: AutoFormatResult['stats'] }
  return { html: fromMca(toMca(html)), stats: { blank: stats.blank, columns: stats.columns, rows: stats.rows, moved: stats.moved } }
}

/** A converted document (Word → HTML) as selectable blocks of editor HTML. */
export function documentBlocks(html: string): string[] {
  return blocks(html) as string[]
}

type Arc = { from: string; to: string }
type NotesAuthority = {
  json: { presentation: Record<string, Arc[]> }
  concept(q: string): { kind: string } | null
  dataType(q: string): string
  label(q: string): string
  conceptElrs(q: string): string[]
  tablesForConcept(q: string): unknown[]
}
type Fact = { key: string; concept: string; period: unknown; dims: unknown[]; nil?: boolean; value: string }
type View = {
  A: NotesAuthority
  filing: { all(): Fact[]; scopeOf(period: unknown): string }
  getValue(q: string, scope: string, dims: unknown[]): { nil?: boolean; value: string } | null
}

const PARENTS = new WeakMap<object, Map<string, Map<string, string>>>()
/** elr → child → parent, from the presentation networks */
function parentsByElr(A: NotesAuthority): Map<string, Map<string, string>> {
  let m = PARENTS.get(A)
  if (!m) {
    m = new Map()
    for (const [elr, arcs] of Object.entries(A.json.presentation)) m.set(elr, new Map(arcs.map((a) => [a.to, a.from])))
    PARENTS.set(A, m)
  }
  return m
}

/** The text block an element sits directly under in the presentation (its parent sub-item hierarchy), if any. */
export function parentTextBlock(A: NotesAuthority, q: string): string | null {
  const parents = parentsByElr(A)
  for (const elr of A.conceptElrs(q)) {
    const p = parents.get(elr)?.get(q)
    if (p && A.concept(p)?.kind === 'item' && A.dataType(p) === 'textBlock') return p
  }
  return null
}

export interface NoteIssue {
  severity: 'INFO'
  code: 'textblock.parent'
  message: string
  factKey: string
  concept: string
  scope: string
}

/**
 * The text-block hierarchy (webXBRL: "the parent text block must be tagged"): a text sub-item reported while the text
 * block it sits directly under is empty (CY: text blocks are current-year only). Once per element. Only narrative
 * sub-items count, not a table's line items. INFO, not a warning: the MCA tool does not require it (Dixon, generated by
 * webXBRL and accepted by MCA, reports 14 such elements); the note editor shows it as a warning when the user saves.
 */
export function noteStructureIssues(session: Session): NoteIssue[] {
  const S = session as unknown as View
  const A = S.A
  const out: NoteIssue[] = []
  const seen = new Set<string>()
  for (const f of S.filing.all()) {
    if (f.nil || f.dims.length || !NOTE_TYPES.has(A.dataType(f.concept)) || A.tablesForConcept(f.concept).length) continue
    const scope = S.filing.scopeOf(f.period)
    if (scope !== 'CY' && scope !== 'PY') continue
    const parent = parentTextBlock(A, f.concept)
    if (!parent || seen.has(f.concept)) continue
    seen.add(f.concept)
    const p = S.getValue(parent, 'CY', [])
    if (!p || p.nil) {
      out.push({ severity: 'INFO', code: 'textblock.parent', message: `${A.label(f.concept)} is reported, but its parent text block "${A.label(parent)}" is empty: tag the parent text block too`, factKey: f.key, concept: f.concept, scope })
    }
  }
  return out
}
