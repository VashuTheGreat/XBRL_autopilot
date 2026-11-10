/**
 * `.axbrl` project file: a zip container (like .docx). Pure Node, no Electron, so it's unit-tested.
 * Format: docs/03-project-file-axbrl.md.
 */
import { existsSync, readFileSync } from 'node:fs'
import { copyFile, open, readFile, rename, rm } from 'node:fs/promises'
import JSZip from 'jszip'

export const AXBRL_FORMAT = 'axbrl'
export const AXBRL_FORMAT_VERSION = 1
export const AXBRL_EXTENSION = '.axbrl'

export interface AxbrlManifest {
  format: typeof AXBRL_FORMAT
  formatVersion: number
  appVersion: string
  projectId: string
  createdAt: string
  updatedAt: string
  taxonomy: { id: string; authorityHash: string | null }
  company: { name: string; cin: string }
  filing: {
    reportType: string
    cy: { start: string; end: string }
    py: { start: string; end: string } | null
    firstFinancialYear: boolean
    roundingLevel: string
  }
  /** imported workbooks: source name (e.g. workbook-1.xlsx) → original file name */
  sources?: Record<string, { fileName: string; importedAt: string }>
}

export interface AxbrlContent {
  manifest: AxbrlManifest
  /** engine Filing.toJSON() — the source of truth for XML */
  filing: unknown
  /** Excel cell ↔ fact linkage (Phase 4/5) */
  mapping: { version: 1; entries: unknown[] }
  validation: unknown | null
  /** source/<name>.xlsx, byte-identical */
  sources: Record<string, Uint8Array>
  /** in-app cell edits over the sources */
  sourceEdits: Record<string, unknown>
  /** mca-errors/<name>.txt */
  mcaErrors: Record<string, string>
  /** ai/history.jsonl (append-only text) */
  aiHistory: string
  /** output/NNN.xml */
  outputs: Record<string, string>
  uiState: unknown | null
  /** entries this version doesn't know; preserved byte-for-byte on save */
  extra: Record<string, Uint8Array>
}

export class AxbrlFormatError extends Error {}

const KNOWN = new Set(['manifest.json', 'filing.json', 'mapping.json', 'validation.json', 'source/edits.json', 'ai/history.jsonl', 'ui-state.json'])
const isKnown = (name: string) =>
  KNOWN.has(name) || /^source\/[^/]+\.xlsx?$/i.test(name) || /^mca-errors\/[^/]+\.txt$/.test(name) || /^output\/[^/]+\.xml$/.test(name)

export function emptyContent(manifest: AxbrlManifest, filing: unknown): AxbrlContent {
  return {
    manifest,
    filing,
    mapping: { version: 1, entries: [] },
    validation: null,
    sources: {},
    sourceEdits: {},
    mcaErrors: {},
    aiHistory: '',
    outputs: {},
    uiState: null,
    extra: {},
  }
}

const json = (v: unknown) => JSON.stringify(v, null, 1)
// Fixed timestamp on every entry so identical content gives an identical archive.
const ZIP_DATE = new Date('2000-01-01T00:00:00Z')

export async function packAxbrl(c: AxbrlContent): Promise<Buffer> {
  const zip = new JSZip()
  const add = (name: string, data: string | Uint8Array) => zip.file(name, data, { date: ZIP_DATE })
  add('manifest.json', json(c.manifest)) // first entry: readers can sniff it cheaply
  add('filing.json', JSON.stringify(c.filing))
  add('mapping.json', json(c.mapping))
  if (c.validation != null) add('validation.json', JSON.stringify(c.validation))
  for (const [name, bytes] of Object.entries(c.sources)) add(`source/${name}`, bytes)
  if (Object.keys(c.sourceEdits).length) add('source/edits.json', json(c.sourceEdits))
  for (const [name, text] of Object.entries(c.mcaErrors)) add(`mca-errors/${name}`, text)
  if (c.aiHistory) add('ai/history.jsonl', c.aiHistory)
  for (const [name, xml] of Object.entries(c.outputs)) add(`output/${name}`, xml)
  if (c.uiState != null) add('ui-state.json', json(c.uiState))
  for (const [name, bytes] of Object.entries(c.extra)) if (!isKnown(name)) add(name, bytes)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

export interface UnpackResult {
  content: AxbrlContent
  /** non-null when the file comes from a newer format version: open read-only */
  readOnlyReason: string | null
}

export async function unpackAxbrl(buf: Uint8Array): Promise<UnpackResult> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buf)
  } catch {
    throw new AxbrlFormatError('This file is not an XBRL Autopilot project (not a valid .axbrl archive).')
  }
  const text = async (name: string) => zip.file(name)?.async('string') ?? null
  const parse = async <T>(name: string): Promise<T | null> => {
    const t = await text(name)
    if (t == null) return null
    try {
      return JSON.parse(t) as T
    } catch {
      throw new AxbrlFormatError(`The project file is damaged: ${name} is not valid JSON.`)
    }
  }

  const manifest = await parse<AxbrlManifest>('manifest.json')
  if (!manifest || manifest.format !== AXBRL_FORMAT) throw new AxbrlFormatError('This file is not an XBRL Autopilot project (manifest missing).')
  if (typeof manifest.formatVersion !== 'number' || manifest.formatVersion < 1) {
    throw new AxbrlFormatError('The project file has an invalid format version.')
  }
  const filing = await parse<unknown>('filing.json')
  if (filing == null) throw new AxbrlFormatError('The project file is damaged: filing.json is missing.')

  const content = emptyContent(manifest, filing)
  content.mapping = (await parse<AxbrlContent['mapping']>('mapping.json')) ?? content.mapping
  content.validation = await parse('validation.json')
  content.sourceEdits = (await parse<Record<string, unknown>>('source/edits.json')) ?? {}
  content.aiHistory = (await text('ai/history.jsonl')) ?? ''
  content.uiState = await parse('ui-state.json')

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue
    const n = entry.name
    if (/^source\/[^/]+\.xlsx?$/i.test(n)) content.sources[n.slice('source/'.length)] = await entry.async('uint8array')
    else if (/^mca-errors\/[^/]+\.txt$/.test(n)) content.mcaErrors[n.slice('mca-errors/'.length)] = await entry.async('string')
    else if (/^output\/[^/]+\.xml$/.test(n)) content.outputs[n.slice('output/'.length)] = await entry.async('string')
    else if (!isKnown(n)) content.extra[n] = await entry.async('uint8array')
  }

  const readOnlyReason =
    manifest.formatVersion > AXBRL_FORMAT_VERSION
      ? `This project was saved by a newer version of XBRL Autopilot (format ${manifest.formatVersion}). It is opened read-only.`
      : null
  return { content, readOnlyReason }
}

/**
 * Atomic save: write <file>.tmp, fsync, keep the previous file as <file>.bak, rename into place.
 * A crash at any point leaves either the old or the new file intact.
 */
export async function writeAxbrl(file: string, c: AxbrlContent): Promise<void> {
  const buf = await packAxbrl(c)
  const tmp = `${file}.tmp`
  const fh = await open(tmp, 'w')
  try {
    await fh.writeFile(buf)
    await fh.sync()
  } finally {
    await fh.close()
  }
  if (existsSync(file)) await copyFile(file, `${file}.bak`)
  await rename(tmp, file)
}

export async function readAxbrl(file: string): Promise<UnpackResult> {
  return unpackAxbrl(await readFile(file))
}

/** Cheap check used by recovery listing: read only the manifest. */
export async function readManifest(file: string): Promise<AxbrlManifest | null> {
  try {
    const zip = await JSZip.loadAsync(readFileSync(file))
    const t = await zip.file('manifest.json')?.async('string')
    return t ? (JSON.parse(t) as AxbrlManifest) : null
  } catch {
    return null
  }
}

export async function removeQuietly(file: string): Promise<void> {
  await rm(file, { force: true })
}
