import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  AXBRL_FORMAT_VERSION,
  AxbrlFormatError,
  emptyContent,
  packAxbrl,
  readAxbrl,
  readManifest,
  unpackAxbrl,
  writeAxbrl,
  type AxbrlManifest,
} from '../electron/main/project/axbrl'

const manifest = (over: Partial<AxbrlManifest> = {}): AxbrlManifest => ({
  format: 'axbrl',
  formatVersion: AXBRL_FORMAT_VERSION,
  appVersion: '0.1.0',
  projectId: 'p1',
  createdAt: '2026-11-10T10:00:00.000Z',
  updatedAt: '2026-11-10T10:00:00.000Z',
  taxonomy: { id: 'ci-2016', authorityHash: 'abc' },
  company: { name: 'Acme Pvt Ltd', cin: 'U12345MH2010PTC123456' },
  filing: {
    reportType: 'Standalone',
    cy: { start: '2025-04-01', end: '2026-03-31' },
    py: { start: '2024-04-01', end: '2025-03-31' },
    firstFinancialYear: false,
    roundingLevel: 'Lakhs',
  },
  ...over,
})

function fullContent() {
  const c = emptyContent(manifest(), { format: 'mca-ci-xbrl-project', facts: [{ concept: 'in-gaap:Assets', value: '100' }] })
  c.mapping.entries.push({ id: 'm1', cell: { sheet: 'BS', ref: 'C5' } })
  c.validation = { issues: [] }
  c.sources['workbook-1.xlsx'] = new Uint8Array([0x50, 0x4b, 1, 2, 3])
  c.sourceEdits = { 'BS!C5': '125000' }
  c.mcaErrors['2026-11-10T1015.txt'] = "cvc-pattern-valid: Value 'X'"
  c.aiHistory = '{"t":1}\n{"t":2}\n'
  c.outputs['001.xml'] = '<xbrli:xbrl/>'
  c.uiState = { rightTab: 'xml' }
  return c
}

describe('.axbrl pack/unpack', () => {
  it('round-trips every part losslessly', async () => {
    const c = fullContent()
    const { content, readOnlyReason } = await unpackAxbrl(await packAxbrl(c))
    expect(readOnlyReason).toBeNull()
    expect(content.manifest).toEqual(c.manifest)
    expect(content.filing).toEqual(c.filing)
    expect(content.mapping).toEqual(c.mapping)
    expect(content.validation).toEqual(c.validation)
    expect(Buffer.from(content.sources['workbook-1.xlsx']!)).toEqual(Buffer.from(c.sources['workbook-1.xlsx']!))
    expect(content.sourceEdits).toEqual(c.sourceEdits)
    expect(content.mcaErrors).toEqual(c.mcaErrors)
    expect(content.aiHistory).toBe(c.aiHistory)
    expect(content.outputs).toEqual(c.outputs)
    expect(content.uiState).toEqual(c.uiState)
    expect(content.extra).toEqual({})
  })

  it('is deterministic for identical content', async () => {
    expect((await packAxbrl(fullContent())).equals(await packAxbrl(fullContent()))).toBe(true)
  })

  it('preserves entries written by a future version', async () => {
    const zip = await JSZip.loadAsync(await packAxbrl(fullContent()))
    zip.file('plugins/future.bin', new Uint8Array([9, 8, 7]))
    const { content } = await unpackAxbrl(await zip.generateAsync({ type: 'uint8array' }))
    expect(Array.from(content.extra['plugins/future.bin']!)).toEqual([9, 8, 7])
    const again = await unpackAxbrl(await packAxbrl(content))
    expect(Array.from(again.content.extra['plugins/future.bin']!)).toEqual([9, 8, 7])
  })

  it('opens newer format versions read-only', async () => {
    const c = fullContent()
    c.manifest.formatVersion = AXBRL_FORMAT_VERSION + 1
    const { readOnlyReason } = await unpackAxbrl(await packAxbrl(c))
    expect(readOnlyReason).toMatch(/newer version/)
  })

  it('rejects non-projects and damaged files with a clear message', async () => {
    await expect(unpackAxbrl(Buffer.from('not a zip'))).rejects.toBeInstanceOf(AxbrlFormatError)
    const zip = new JSZip()
    zip.file('hello.txt', 'x')
    await expect(unpackAxbrl(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/manifest missing/)
    const bad = new JSZip()
    bad.file('manifest.json', JSON.stringify(manifest()))
    bad.file('filing.json', '{oops')
    await expect(unpackAxbrl(await bad.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/filing.json is not valid JSON/)
  })
})

describe('.axbrl on disk', () => {
  it('writes atomically, keeps one .bak generation and reads back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'axbrl-'))
    const file = join(dir, 'acme.axbrl')
    const c = fullContent()
    await writeAxbrl(file, c)
    expect(existsSync(`${file}.tmp`)).toBe(false)
    expect(existsSync(`${file}.bak`)).toBe(false)
    const first = readFileSync(file)

    c.aiHistory += '{"t":3}\n'
    await writeAxbrl(file, c)
    expect(readFileSync(`${file}.bak`).equals(first)).toBe(true)
    expect((await readAxbrl(file)).content.aiHistory).toBe(c.aiHistory)
    expect((await readManifest(file))?.company.name).toBe('Acme Pvt Ltd')
  })

  it('readManifest returns null for junk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'axbrl-'))
    const junk = join(dir, 'junk.axbrl')
    writeFileSync(junk, 'junk')
    expect(await readManifest(junk)).toBeNull()
  })
})
