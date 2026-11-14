import { CircleCheck, Search, TriangleAlert, Wand2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ConceptHit } from '@shared/editor'
import { layoutHints, type NoteCheckView, type NoteEditorView } from '@shared/notes'
import { Button, Dialog, Input } from '@/components/ui/primitives'
import { unwrap } from '@/lib/result'
import { useNotes } from '@/stores/notes'
import { RichTextEditor } from './RichTextEditor'
import { useNoteEditorShortcut } from './useNoteEditorShortcut'

/**
 * The note editor (F2, docs/14 Step 6): rich text for a text block (MCA subset; paste from Word / Excel keeps
 * paragraphs and tables; Auto format tidies pasted tables), plain text for a text item. A live check says whether the
 * content renders in the MCA PDF. Saved as the CY value: text blocks are current-year only.
 */
export function NoteEditorDialog() {
  const target = useNotes((s) => s.target)
  const close = useNotes((s) => s.close)
  useNoteEditorShortcut()
  if (!target) return null
  return target.kind === 'choose' ? <ChooseElement initialHtml={target.initialHtml} onClose={close} /> : <Editor key={target.view.concept} view={target.view} initialHtml={target.initialHtml} onClose={close} />
}

function Editor(props: { view: NoteEditorView; initialHtml: string | null; onClose(): void }) {
  const { view } = props
  const save = useNotes((s) => s.save)
  const [html, setHtml] = useState(props.initialHtml ?? view.html)
  const [resetSeq, setResetSeq] = useState(0)
  const [check, setCheck] = useState<NoteCheckView | null>(null)
  const [saving, setSaving] = useState(false)
  const rich = view.dataType === 'textBlock'

  useEffect(() => {
    const t = setTimeout(() => void unwrap(window.xap.notes.check({ html, dataType: view.dataType }), { quiet: true }).then((c) => setCheck(c ?? null)), 300)
    return () => clearTimeout(t)
  }, [html, view.dataType])

  const autoFormat = async () => {
    const r = await unwrap(window.xap.notes.autoFormat(html))
    if (!r) return
    setHtml(r.html)
    setResetSeq((n) => n + 1)
  }
  const submit = async () => {
    setSaving(true)
    const ok = await save(view.concept, html)
    setSaving(false)
    if (ok) props.onClose()
  }

  return (
    <Dialog
      open
      onClose={props.onClose}
      title={`${view.label} · CY`}
      width={860}
      footer={
        <>
          {rich && (
            <Button variant="ghost" onClick={() => void autoFormat()} title="Tidy pasted tables: rebuild them on a grid, drop empty rows, columns and paragraphs (text is never removed)">
              <Wand2 size={13} /> Auto format
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={saving || check?.renders === false}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex h-[60vh] flex-col gap-2 text-xs" data-testid="note-editor" data-concept={view.concept}>
        {view.parent?.empty && (
          <p className="flex items-center gap-1.5 text-warn">
            <TriangleAlert size={12} /> Its parent text block “{view.parent.label}” is empty: tag the parent text block too.
          </p>
        )}
        {rich ? (
          <RichTextEditor html={html} resetSeq={resetSeq} onChange={setHtml} clean={(h) => unwrap(window.xap.notes.clean(h))} />
        ) : (
          <textarea className="min-h-48 flex-1 rounded border border-border bg-panel px-3 py-2 text-[13px] outline-none focus:border-accent select-text" value={plainOf(html)} onChange={(e) => setHtml(e.target.value)} aria-label="Note text" />
        )}
        <CheckStatus check={check} />
      </div>
    </Dialog>
  )
}

function CheckStatus({ check }: { check: NoteCheckView | null }) {
  if (!check) return <p className="text-muted">Checking…</p>
  const hints = layoutHints(check.layout)
  return (
    <div className="flex flex-col gap-0.5" data-testid="note-check">
      {check.renders ? (
        <p className="flex items-center gap-1.5 text-ok">
          <CircleCheck size={12} /> Will render in the MCA PDF.
        </p>
      ) : (
        check.errors.map((e) => (
          <p key={e} className="flex items-center gap-1.5 text-err">
            <TriangleAlert size={12} /> {e}
          </p>
        ))
      )}
      {[...check.warnings, ...hints.map((h) => `Prints untidily: ${h}.`)].map((w) => (
        <p key={w} className="text-[11px] text-warn">
          {w}
        </p>
      ))}
    </div>
  )
}

/** F2 on a text cell that is not tagged: choose the text block / text item it is, then edit. */
function ChooseElement(props: { initialHtml: string; onClose(): void }) {
  const openElement = useNotes((s) => s.openElement)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ConceptHit[]>([])
  useEffect(() => {
    if (query.trim().length < 2) return setHits([])
    const t = setTimeout(
      () => void unwrap(window.xap.editor.searchConcepts(query), { quiet: true }).then((r) => setHits((r ?? []).filter((h) => h.nonDimensional && (h.dataType === 'textBlock' || h.dataType === 'string')))),
      250,
    )
    return () => clearTimeout(t)
  }, [query])
  return (
    <Dialog open onClose={props.onClose} title="Which text block is this?" width={560}>
      <div className="flex flex-col gap-2 text-xs" data-testid="note-choose">
        <p className="text-muted">The cell is not tagged. Choose the text block or text item it belongs to; its text opens in the editor.</p>
        <label className="flex items-center gap-1.5">
          <Search size={13} className="text-muted" />
          <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search text blocks (e.g. directors report)" aria-label="Search text blocks" />
        </label>
        <ul className="max-h-72 overflow-auto">
          {hits.map((h) => (
            <li key={h.qname}>
              <button type="button" className="w-full rounded px-2 py-1 text-left hover:bg-panel-2" onClick={() => void openElement(h.qname, props.initialHtml)} title={h.qname}>
                {h.label} <span className="text-[10px] text-muted">{h.dataType === 'textBlock' ? 'text block' : 'text'}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  )
}

/** A text item's editor HTML as the plain text the textarea shows. */
function plainOf(html: string): string {
  if (!/<[a-z]/i.test(html)) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return [...doc.body.children].map((el) => el.textContent ?? '').join('\n\n') || (doc.body.textContent ?? '')
}

