import { Bold, Heading, Italic, List, ListOrdered, Underline } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/primitives'

/**
 * A rich-text area limited to what an MCA text block can hold: bold / italic / underline, a heading, lists, and the
 * tables pasted from Word or Excel. Pasted content goes through main's sanitiser (engine richtext) before it is
 * inserted, so the editor never holds what the MCA subset cannot express.
 */
export function RichTextEditor(props: {
  /** the content when the editor opens (or is reset, e.g. by Auto format) */
  html: string
  /** bumped to replace the content with `html` */
  resetSeq: number
  onChange(html: string): void
  clean(html: string): Promise<string | undefined>
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = props.html
    // only on reset: typing must not re-render the content under the caret
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.resetSeq])

  const command = (name: string, value?: string) => {
    ref.current?.focus()
    document.execCommand(name, false, value)
    props.onChange(ref.current?.innerHTML ?? '')
  }
  const paste = async (e: React.ClipboardEvent) => {
    e.preventDefault()
    const html = e.clipboardData.getData('text/html')
    const text = e.clipboardData.getData('text/plain')
    const cleaned = await props.clean(html || escapeText(text))
    if (cleaned) command('insertHTML', cleaned)
  }

  const tools: [string, typeof Bold, () => void][] = [
    ['Bold (Ctrl+B)', Bold, () => command('bold')],
    ['Italic (Ctrl+I)', Italic, () => command('italic')],
    ['Underline (Ctrl+U)', Underline, () => command('underline')],
    ['Heading', Heading, () => command('formatBlock', 'h5')],
    ['Bulleted list', List, () => command('insertUnorderedList')],
    ['Numbered list', ListOrdered, () => command('insertOrderedList')],
  ]
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded border border-border">
      <div className="flex items-center gap-0.5 border-b border-border bg-panel-2 px-1 py-0.5">
        {tools.map(([title, Icon, run]) => (
          <Button key={title} variant="ghost" className="h-6 px-1.5" title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={run}>
            <Icon size={13} />
          </Button>
        ))}
        <Button variant="ghost" className="h-6 px-1.5 text-[11px]" title="Normal paragraph" onMouseDown={(e) => e.preventDefault()} onClick={() => command('formatBlock', 'p')}>
          ¶
        </Button>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Note text"
        data-testid="note-editor-area"
        className="note-editor min-h-48 flex-1 overflow-auto bg-panel px-3 py-2 text-[13px] leading-relaxed outline-none select-text [&_h5]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_table]:my-2 [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-1.5 [&_th]:border [&_th]:border-border [&_th]:px-1.5 [&_ul]:list-disc [&_ul]:pl-6"
        onInput={() => props.onChange(ref.current?.innerHTML ?? '')}
        onPaste={(e) => void paste(e)}
      />
    </div>
  )
}

/** Plain clipboard text as paragraphs (blank lines separate paragraphs, single newlines are line breaks). */
function escapeText(text: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((p) => `<p>${esc(p).replace(/\r?\n/g, '<br>')}</p>`)
    .join('')
}
