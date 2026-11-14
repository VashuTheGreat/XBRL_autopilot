import { FileDown, RefreshCw } from 'lucide-react'
import { useEffect } from 'react'
import { PREVIEW_SPACINGS, type PreviewSpacing } from '@xap/engine/basics'
import { Button, Checkbox, Select } from '@/components/ui/primitives'
import { usePreview } from '@/stores/preview'
import { useProject } from '@/stores/project'

/**
 * Preview tab (docs/14 Step 7): the open filing rendered MCA-style by main (one section per statement / note, tables,
 * text blocks, Indian grouping). Shown in a fully sandboxed frame (no scripts, no access to the app). Format settings
 * are saved with the filing; Export PDF prints the same document.
 */
export function PreviewView() {
  const { doc, loading, exporting, load, setFormat, exportPdf } = usePreview()
  const revision = useProject((s) => s.summary?.revision)
  // re-rendered whenever the filing changes
  useEffect(() => void load(), [revision, load])
  const f = doc?.format
  return (
    <div className="flex h-full flex-col" data-testid="preview">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-1.5 text-xs">
        {f && (
          <>
            <Checkbox label="Borders" checked={f.borders} onChange={(v) => void setFormat({ borders: v })} />
            <Checkbox label="Bold headings" checked={f.boldHeadings} onChange={(v) => void setFormat({ boldHeadings: v })} />
            <label className="flex items-center gap-1.5">
              Spacing
              <Select className="h-6 py-0 text-xs" value={f.spacing} onChange={(e) => void setFormat({ spacing: e.target.value as PreviewSpacing })} data-testid="preview-spacing">
                {PREVIEW_SPACINGS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </label>
          </>
        )}
        <div className="flex-1" />
        <span className="text-[11px] text-muted">Preview only — the official PDF comes from the MCA tool.</span>
        <Button variant="ghost" className="h-6 px-2" onClick={() => void load()} disabled={loading} title="Render again">
          <RefreshCw size={13} />
        </Button>
        <Button className="h-6 px-2" onClick={() => void exportPdf()} disabled={!doc || exporting} data-testid="preview-export-pdf">
          <FileDown size={13} /> {exporting ? 'Exporting…' : 'Export PDF'}
        </Button>
      </div>
      {doc ? (
        <iframe title="Filing preview" sandbox="" srcDoc={doc.html} className="min-h-0 flex-1 bg-white" data-testid="preview-frame" />
      ) : (
        <p className="p-4 text-xs text-muted">{loading ? 'Rendering…' : 'Open a filing to preview it.'}</p>
      )}
    </div>
  )
}
