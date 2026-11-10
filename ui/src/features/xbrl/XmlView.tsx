import Editor, { type OnMount } from '@monaco-editor/react'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import '@/lib/monaco'
import type { monaco as Monaco } from '@/lib/monaco'
import { useEditor } from '@/stores/editor'

type Ed = Monaco.editor.IStandaloneCodeEditor

const prefersDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches

/** Live, read-only instance XML. Selecting a fact highlights its line; clicking a fact line selects it. */
export function XmlView() {
  const { xml, selection, selectFact, setXmlWanted } = useEditor()
  const editorRef = useRef<Ed | null>(null)
  const decorations = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null)
  const [dark, setDark] = useState(prefersDark)

  useEffect(() => {
    void setXmlWanted(true)
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    const onChange = () => setDark(prefersDark())
    mq?.addEventListener('change', onChange)
    return () => {
      void setXmlWanted(false)
      mq?.removeEventListener('change', onChange)
    }
  }, [setXmlWanted])

  const factByLine = useMemo(() => new Map(Object.entries(xml?.factLines ?? {}).map(([k, l]) => [l, k])), [xml])
  const selectedLine = selection.factKey ? xml?.factLines[selection.factKey] : undefined

  useEffect(() => {
    const ed = editorRef.current
    if (!ed) return
    decorations.current?.clear()
    if (!selectedLine) return
    decorations.current = ed.createDecorationsCollection([
      { range: { startLineNumber: selectedLine, startColumn: 1, endLineNumber: selectedLine, endColumn: 1 }, options: { isWholeLine: true, className: 'xap-xml-line', linesDecorationsClassName: 'xap-xml-gutter' } },
    ])
    ed.revealLineInCenterIfOutsideViewport(selectedLine)
  }, [selectedLine, xml])

  const onMount: OnMount = (ed) => {
    editorRef.current = ed
    ed.onMouseDown((e) => {
      const line = e.target.position?.lineNumber
      const key = line ? factByLineRef.current.get(line) : undefined
      if (key) selectFact(key)
    })
  }
  const factByLineRef = useRef(factByLine)
  factByLineRef.current = factByLine

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-[11px]">
        {xml ? (
          xml.validated ? (
            <span className="flex items-center gap-1 text-ok">
              <CircleCheck size={13} /> Passes internal validation
            </span>
          ) : (
            <span className="flex items-center gap-1 text-warn" data-testid="xml-status">
              <CircleAlert size={13} /> Preview — {xml.errorCount} validation error(s) remain; not ready to file
            </span>
          )
        ) : (
          <span className="text-muted">Generating…</span>
        )}
        <span className="flex-1" />
        {xml && <span className="text-muted">{Object.keys(xml.factLines).length} facts</span>}
      </div>
      <div className="min-h-0 flex-1" data-testid="xml-editor">
        <Editor
          value={xml?.xml ?? ''}
          language="xml"
          theme={dark ? 'vs-dark' : 'vs'}
          onMount={onMount}
          options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12, wordWrap: 'off', scrollBeyondLastLine: false, renderLineHighlight: 'none', domReadOnly: true }}
        />
      </div>
    </div>
  )
}
