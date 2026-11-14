/**
 * PdfRenderer on Electron: loads the HTML into a hidden window with no preload, no Node, sandboxed and with
 * JavaScript off (the preview needs none), then prints it to A4 PDF honouring the document's @page rules.
 */
import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import type { PdfRenderer } from '../services/ports'

export class ElectronPdfRenderer implements PdfRenderer {
  async render(html: string): Promise<Uint8Array> {
    // a file, not a data: URL: previews of large filings exceed URL limits
    const file = join(tmpdir(), `xap-preview-${randomUUID()}.html`)
    await writeFile(file, html, 'utf8')
    const win = new BrowserWindow({
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, javascript: false },
    })
    try {
      await win.loadFile(file)
      const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true })
      return new Uint8Array(pdf)
    } finally {
      win.destroy()
      await rm(file, { force: true })
    }
  }
}
