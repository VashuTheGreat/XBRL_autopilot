/**
 * PdfExportService (docs/14 Step 7): Export PDF of the preview. The rendering (Electron printToPDF in a hidden,
 * sandboxed window) and the file write are ports, so this is tested without Electron.
 */
import type { PdfExportResult } from '@shared/preview'
import type { FileWriter, PdfRenderer } from './ports'
import type { PreviewService } from './preview-service'

export class PdfExportService {
  constructor(
    private readonly preview: Pick<PreviewService, 'document'>,
    private readonly renderer: PdfRenderer,
    private readonly write: FileWriter,
  ) {}

  /** Renders the open filing's preview (in its format settings) to `path` (".pdf" added when missing). */
  async export(path: string): Promise<PdfExportResult> {
    const file = /\.pdf$/i.test(path) ? path : `${path}.pdf`
    const bytes = await this.renderer.render(this.preview.document().html)
    await this.write(file, bytes)
    return { path: file, bytes: bytes.length }
  }
}
