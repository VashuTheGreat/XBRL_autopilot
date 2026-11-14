/** Preview / PDF contracts (docs/14 Step 7), shared by main, preload and renderer. */
import type { PreviewFormat } from '@xap/engine/basics'

export type { PreviewFormat }

/** The open filing rendered MCA-style (engine buildPreviewHtml), with the format it was rendered in. */
export interface PreviewDocument {
  html: string
  format: PreviewFormat
}

export interface PdfExportResult {
  path: string
  bytes: number
}
