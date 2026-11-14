/**
 * PreviewService (docs/14 Step 7): the open filing as an MCA-like printable document (engine buildPreviewHtml: company
 * header, one section per statement / note, tables, text blocks, Indian grouping), in the filing's own format settings
 * (`.axbrl` preview.json). Display only: it changes no fact.
 */
import { buildPreviewHtml } from '@xap/engine'
import { normalizePreviewFormat, type PreviewFormat } from '@xap/engine/basics'
import type { PreviewDocument } from '@shared/preview'
import type { ProjectAccess } from './ports'

export class PreviewService {
  constructor(
    private readonly projects: ProjectAccess,
    private readonly build: string,
  ) {}

  /** The preview HTML (no in-page print bar: the app shows it in a sandboxed frame) and its format. */
  document(): PreviewDocument {
    const p = this.projects.project()
    const format = this.format()
    return { html: buildPreviewHtml(p.session, { build: this.build, format, printBar: false }) as string, format }
  }

  format(): PreviewFormat {
    return normalizePreviewFormat(this.projects.project().content.preview)
  }

  /** Changes some format settings of this filing (saved with it) and returns the re-rendered preview. */
  setFormat(patch: Partial<PreviewFormat>): PreviewDocument {
    const p = this.projects.project()
    p.content.preview = normalizePreviewFormat({ ...this.format(), ...patch })
    p.touch()
    return this.document()
  }

  /** "Acme Pvt Ltd 2025-26 preview.pdf": a file name for Export PDF. */
  suggestedFileName(): string {
    const m = this.projects.project().session.filing.meta as { name?: string; periods: { cy: { start: string; end: string } } }
    const fy = `${m.periods.cy.start.slice(0, 4)}-${m.periods.cy.end.slice(2, 4)}`
    const name = (m.name || 'Filing').replace(/[\/:*?"<>|]+/g, ' ').trim()
    return `${name} ${fy} preview.pdf`
  }
}
