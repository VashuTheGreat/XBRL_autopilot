/**
 * Preview + PDF (docs/14 Step 7): PreviewService renders the open filing in its format settings, which round-trip
 * through `.axbrl`; PdfExportService prints that document through a mocked printToPDF port. Synthetic Ind AS filing
 * on the knowledge-base authority — no client data, no Electron.
 */
import { join } from 'node:path'
import { DEFAULT_PREVIEW_FORMAT } from '@xap/engine/basics'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MappingService } from '../electron/main/services/mapping-service'
import { PdfExportService } from '../electron/main/services/pdf-export-service'
import type { PdfRenderer } from '../electron/main/services/ports'
import type { ProjectService } from '../electron/main/services/project-service'
import { PreviewService } from '../electron/main/services/preview-service'
import { kbReady } from './helpers/kb-authorities'
import { cell, P, syntheticIndAsFiling } from './helpers/synthetic-ind-as'

describe.skipIf(!kbReady)('preview and PDF export', () => {
  let projects: ProjectService
  let mapping: MappingService
  let dir: string
  let preview: PreviewService

  beforeEach(async () => {
    ;({ projects, mapping, dir } = await syntheticIndAsFiling())
    preview = new PreviewService(projects, 'test')
    await mapping.tag({ cell: cell('BS', 'C3'), concept: `${P}PropertyPlantAndEquipment` }) // 1.23 lakhs
  })

  it('renders the open filing MCA-style, with no in-page script', () => {
    const d = preview.document()
    expect(d.format).toEqual(DEFAULT_PREVIEW_FORMAT)
    expect(d.html).toMatch(/Synthetic Pvt Ltd/)
    expect(d.html).toMatch(/Unless otherwise specified, all monetary values are in Lakhs of INR/)
    expect(d.html).toMatch(/<h2>\[\d{6}\] Balance sheet<\/h2>/)
    expect(d.html).toContain('>1.23<')
    expect(d.html).not.toMatch(/<script|onclick/)
  })

  it('saves format settings with the filing, re-renders, and round-trips them through .axbrl', async () => {
    const before = projects.summary()!.revision
    const d = preview.setFormat({ borders: true, spacing: 'relaxed' })
    expect(d.format).toEqual({ ...DEFAULT_PREVIEW_FORMAT, borders: true, spacing: 'relaxed' })
    expect(d.html).toContain('border: 1px solid #999')
    expect(projects.summary()!.dirty).toBe(true)
    expect(projects.summary()!.revision).toBeGreaterThanOrEqual(before)

    const file = join(dir, 'preview.axbrl')
    await projects.saveAs(file)
    await projects.close()
    await projects.open(file)
    expect(preview.format()).toEqual({ ...DEFAULT_PREVIEW_FORMAT, borders: true, spacing: 'relaxed' })
    expect(preview.document().html).toContain('line-height: 1.6')
  })

  it('ignores unknown format values', () => {
    expect(preview.setFormat({ spacing: 'huge' as never }).format.spacing).toBe(DEFAULT_PREVIEW_FORMAT.spacing)
  })

  it('suggests a file name from the company and year', () => {
    expect(preview.suggestedFileName()).toBe('Synthetic Pvt Ltd 2025-26 preview.pdf')
  })

  it('exports the preview as PDF through printToPDF (mocked) to the chosen path', async () => {
    preview.setFormat({ boldHeadings: true })
    const render = vi.fn(async (_html: string) => new Uint8Array([0x25, 0x50, 0x44, 0x46]))
    const write = vi.fn(async () => {})
    const pdf = new PdfExportService(preview, { render } satisfies PdfRenderer, write)
    const r = await pdf.export(join(dir, 'out'))
    expect(r).toEqual({ path: join(dir, 'out.pdf'), bytes: 4 })
    expect(render).toHaveBeenCalledWith(preview.document().html)
    expect(render.mock.calls[0]![0]).toContain('h2, h3, .tblhead')
    expect(write).toHaveBeenCalledWith(join(dir, 'out.pdf'), new Uint8Array([0x25, 0x50, 0x44, 0x46]))
    expect((await pdf.export(join(dir, 'x.PDF'))).path).toBe(join(dir, 'x.PDF'))
  })

  it('a failed print writes nothing', async () => {
    const write = vi.fn(async () => {})
    const pdf = new PdfExportService(preview, { render: async () => Promise.reject(new Error('print failed')) }, write)
    await expect(pdf.export(join(dir, 'y.pdf'))).rejects.toThrow('print failed')
    expect(write).not.toHaveBeenCalled()
  })
})
