/**
 * Importing an existing XBRL instance (Webtel or any vendor) and proving the round trip (Phase 7).
 *
 * - `importXbrl` wraps the legacy importer with an XML parser that works in Node/Electron (xmldom).
 * - `canonicalFacts` / `compareInstanceFacts` compare two instances by meaning, not text: each fact is
 *   (concept, period, dimensions) → (unit, decimals, value). Context and fact ids, order and formatting are ignored.
 * - `instanceConventions` summarises the vendor-specific choices that don't change the facts (context id style,
 *   fact ids, generator comment, duplicate contexts…), for the import diff report.
 */
import { DOMParser } from '@xmldom/xmldom'
import { importInstance } from './core/importer.js'
import { Session } from './core/session.js'

const XBRLI = 'http://www.xbrl.org/2003/instance'
const XBRLDI = 'http://xbrl.org/2006/xbrldi'
const LINK = 'http://www.xbrl.org/2003/linkbase'
const XSI = 'http://www.w3.org/2001/XMLSchema-instance'

export type ImportMode = 'both' | 'next'

interface XmlEl {
  namespaceURI: string | null
  localName: string
  prefix: string | null
  textContent: string | null
  firstChild: XmlNode | null
  getAttribute(name: string): string | null
  getAttributeNS(ns: string, name: string): string | null
  getElementsByTagNameNS(ns: string, local: string): ArrayLike<XmlEl>
}
interface XmlNode {
  nodeType: number
  nextSibling: XmlNode | null
}

/**
 * xmldom 0.8 reports problems through `errorHandler`; the legacy importer passes `onError` (the browser-era
 * signature), which xmldom would ignore. This adapter maps one onto the other, so malformed XML is reported.
 */
class ReportingDOMParser {
  private readonly inner: InstanceType<typeof DOMParser>
  constructor(opts: { onError?: (level: string, msg: string) => void } = {}) {
    this.inner = new DOMParser({ errorHandler: (level: string, msg: string) => opts.onError?.(level, msg) } as never)
  }
  parseFromString(xml: string, mime: string) {
    return this.inner.parseFromString(xml, mime)
  }
}

const parse = (xml: string): XmlEl => {
  const errors: string[] = []
  const doc = new ReportingDOMParser({ onError: (level, msg) => { if (level !== 'warning') errors.push(msg) } }).parseFromString(xml, 'application/xml')
  if (errors.length || !doc.documentElement) throw new Error(`Not a well-formed XML instance: ${errors[0] ?? 'no root element'}`)
  return doc.documentElement as unknown as XmlEl
}
const children = (el: XmlEl): XmlEl[] => {
  const out: XmlEl[] = []
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n as unknown as XmlEl)
  return out
}
const all = (el: XmlEl, ns: string, local: string) => Array.from(el.getElementsByTagNameNS(ns, local))

/** The instance's schemaRef href, read cheaply (no full parse). */
export function readSchemaRef(xml: string): string | null {
  const m = /<(?:[\w-]+:)?schemaRef\b[^>]*?(?:xlink:)?href\s*=\s*"([^"]+)"/.exec(xml)
  return m ? m[1]! : null
}

export interface ImportedInstance {
  filing: unknown
  report: Record<string, any>
}

/** Reads an instance into a new Filing. `next`: the source's current year becomes the previous year of the next filing. */
export function importXbrl(authority: unknown, xml: string, { fileName = 'instance.xml', mode = 'both' as ImportMode } = {}): ImportedInstance {
  return importInstance(authority, xml, { DOMParserImpl: ReportingDOMParser, fileName, yearMode: mode }) as ImportedInstance
}

// ------------------------------------------------------------------------------------------- semantic comparison
const normNumber = (v: string) => {
  const t = v.trim()
  if (!/^[+-]?\d+(\.\d+)?$/.test(t)) return t
  let s = t.replace(/^\+/, '').replace(/^(-?)0+(?=\d)/, '$1')
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  return s === '-0' ? '0' : s
}

/** fact key `concept|period|dims` → canonical values `unit|decimals|value` (several when duplicated). */
export function canonicalFacts(xml: string): Map<string, string[]> {
  const root = parse(xml)
  const contexts: Record<string, string> = {}
  const units: Record<string, string> = {}
  for (const c of children(root).filter((e) => e.namespaceURI === XBRLI && e.localName === 'context')) {
    const p = all(c, XBRLI, 'period')[0]
    const g = (l: string) => (p ? all(p, XBRLI, l)[0]?.textContent?.trim() : undefined)
    const period = g('instant') ? `I${g('instant')}` : `D${g('startDate')}/${g('endDate')}`
    const dims = [
      ...all(c, XBRLDI, 'explicitMember').map((m) => `${m.getAttribute('dimension')}=${m.textContent?.trim()}`),
      ...all(c, XBRLDI, 'typedMember').map((m) => `${m.getAttribute('dimension')}~${(m.textContent ?? '').replace(/\s+/g, ' ').trim()}`),
    ].sort()
    contexts[c.getAttribute('id') ?? ''] = `${period}|${dims.join(',')}`
  }
  for (const u of children(root).filter((e) => e.namespaceURI === XBRLI && e.localName === 'unit')) {
    const measures = all(u, XBRLI, 'measure').map((m) => (m.textContent ?? '').trim().split(':').pop())
    units[u.getAttribute('id') ?? ''] = measures.join('/')
  }
  const out = new Map<string, string[]>()
  for (const f of children(root)) {
    const ctx = f.getAttribute('contextRef')
    if (!ctx) continue
    const unit = units[f.getAttribute('unitRef') ?? ''] ?? ''
    const nil = f.getAttributeNS(XSI, 'nil') === 'true'
    const raw = f.textContent ?? ''
    const value = nil ? 'NIL' : unit ? normNumber(raw) : raw.replace(/\s+/g, ' ').trim()
    const key = `${f.prefix}:${f.localName}|${contexts[ctx] ?? `?${ctx}`}`
    const list = out.get(key) ?? []
    list.push(`${unit}|${f.getAttribute('decimals') ?? ''}|${value}`)
    out.set(key, list)
  }
  return out
}

export interface FactDifference {
  key: string
  source: string[]
  regenerated: string[]
}

export interface InstanceComparison {
  sourceFacts: number
  regeneratedFacts: number
  equal: number
  missing: string[]
  extra: string[]
  changed: FactDifference[]
  /** true when every source fact is regenerated with the same meaning and nothing is added */
  identical: boolean
}

export function compareInstanceFacts(sourceXml: string, regeneratedXml: string): InstanceComparison {
  const a = canonicalFacts(sourceXml)
  const b = canonicalFacts(regeneratedXml)
  const count = (m: Map<string, string[]>) => [...m.values()].reduce((n, v) => n + v.length, 0)
  const missing: string[] = []
  const changed: FactDifference[] = []
  let equal = 0
  for (const [key, values] of a) {
    const other = b.get(key)
    if (!other) missing.push(key)
    else if ([...other].sort().join('\n') === [...values].sort().join('\n')) equal += values.length
    else changed.push({ key, source: values, regenerated: other })
  }
  const extra = [...b.keys()].filter((k) => !a.has(k))
  return {
    sourceFacts: count(a),
    regeneratedFacts: count(b),
    equal,
    missing,
    extra,
    changed,
    identical: !missing.length && !extra.length && !changed.length,
  }
}

/** Regenerates the imported filing and compares it with the source instance by meaning. */
export function verifyRoundTrip(authority: unknown, filing: unknown, sourceXml: string, today: string): InstanceComparison {
  const S = new Session(authority as never, filing as never)
  const { xml } = S.exportXml({ today, allowErrors: true }) as { xml: string }
  return compareInstanceFacts(sourceXml, xml)
}

// ------------------------------------------------------------------------------------------- vendor conventions
export interface InstanceConventions {
  generator: string | null
  schemaRef: string | null
  contexts: number
  /** contexts that repeat another's period + dimensions (Filing Manual: not allowed; merged on import) */
  duplicateContexts: number
  /** e.g. `I2026_CurrentMember_…_401100` (descriptive) vs `I2026_a1b2c3` (short) */
  contextIdStyle: 'descriptive' | 'short'
  longestContextId: number
  facts: number
  factsWithId: number
  units: string[]
  footnotes: number
  /** decimals values used on numeric facts, with counts */
  decimals: Record<string, number>
}

export function instanceConventions(xml: string): InstanceConventions {
  const root = parse(xml)
  const generator = /<!--\s*(Generated[^>]*?)\s*-->/i.exec(xml)?.[1]?.replace(/\s+/g, ' ') ?? null
  const ctxEls = children(root).filter((e) => e.namespaceURI === XBRLI && e.localName === 'context')
  const ids = ctxEls.map((c) => c.getAttribute('id') ?? '')
  const signatures = new Set<string>()
  let duplicateContexts = 0
  for (const c of ctxEls) {
    const p = all(c, XBRLI, 'period')[0]
    const dims = [...all(c, XBRLDI, 'explicitMember'), ...all(c, XBRLDI, 'typedMember')].map((m) => `${m.getAttribute('dimension')}=${(m.textContent ?? '').trim()}`).sort()
    const sig = `${(p?.textContent ?? '').replace(/\s+/g, '')}|${dims.join(',')}`
    if (signatures.has(sig)) duplicateContexts++
    signatures.add(sig)
  }
  const factEls = children(root).filter((e) => !!e.getAttribute('contextRef'))
  const decimals: Record<string, number> = {}
  for (const f of factEls) {
    const d = f.getAttribute('decimals')
    if (d) decimals[d] = (decimals[d] ?? 0) + 1
  }
  const longest = Math.max(0, ...ids.map((i) => i.length))
  return {
    generator,
    schemaRef: readSchemaRef(xml),
    contexts: ctxEls.length,
    duplicateContexts,
    contextIdStyle: ids.some((i) => /[A-Z][a-z]+Member_|Axis/.test(i)) ? 'descriptive' : 'short',
    longestContextId: longest,
    facts: factEls.length,
    factsWithId: factEls.filter((f) => !!f.getAttribute('id')).length,
    units: children(root).filter((e) => e.namespaceURI === XBRLI && e.localName === 'unit').map((u) => u.getAttribute('id') ?? ''),
    footnotes: all(root, LINK, 'footnote').length,
    decimals,
  }
}
