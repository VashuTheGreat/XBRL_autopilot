/**
 * Preview / PDF (docs/14 Step 7): buildPreviewHtml on a synthetic C&I filing (knowledge-base authority) — Indian
 * grouping, one section per statement / note, text blocks — and the MCA-style format settings (preview-format.js).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREVIEW_FORMAT, normalizePreviewFormat } from '../src/basics'
import { assembleAuthority, Authority, buildPreviewHtml, Session } from '../src/index'
import { previewFormatCss } from '../src/core/preview-format.js'

const KB = (f: string) => new URL(`../../knowledge_base/${f}`, import.meta.url)
const json = (u: URL) => JSON.parse(readFileSync(u, 'utf8'))
const A = new Authority(assembleAuthority(json(KB('ci_engine_authority.json')), json(KB('ci_engine_rules.json'))))
const Q = (local: string) => `in-gaap:${local}`

function filing() {
  const S = new Session(A)
  S.setMeta({
    name: 'Synthetic Pvt Ltd', cin: 'U72200KA2010PTC123456', reportType: 'Standalone', level: 'Actual', statementPlaces: 2, displayPlaces: 2,
    periods: { cy: { start: '2025-04-01', end: '2026-03-31' }, py: { start: '2024-04-01', end: '2025-03-31' } },
  })
  S.setValue(Q('ShareCapital'), 'CY', '10000000')
  S.setValue(Q('ShareCapital'), 'PY', '7500000.5')
  S.setValue('in-ca:DisclosureInBoardOfDirectorsReportExplanatoryTextBlock', 'CY', '<p>Board report</p><table><tr><td class="bordered">1</td></tr></table>')
  return S
}

describe('buildPreviewHtml on a synthetic filing', () => {
  const html = buildPreviewHtml(filing(), { build: 'test', printBar: false })

  it('renders the filing MCA-style: header, a section per statement / note, Indian grouping, text blocks', () => {
    expect(html).toMatch(/Standalone Financial Statements for period 01\/04\/2025 to 31\/03\/2026/)
    expect(html).toMatch(/<h2>\[100100\] Balance sheet<\/h2>/)
    expect(html).toContain('>1,00,00,000<')
    expect(html).toContain('>75,00,000.5<')
    expect(html).toMatch(/Textual information \(1\)/)
    expect(html).toContain('<td class="bordered"><p>1</p></td>')
    expect(html).not.toContain('class="bar"') // no in-page print bar (and no inline script handler) in the app
    expect(html).not.toContain('onclick')
  })

  it('matches the snapshot', () => {
    expect(html).toMatchSnapshot()
  })

  it('keeps the legacy print bar unless asked otherwise', () => {
    expect(buildPreviewHtml(filing())).toContain('class="bar"')
  })
})

describe('MCA-style format settings', () => {
  it('layers borders, bold headings and spacing over the base styles; the default adds nothing', () => {
    expect(previewFormatCss(null)).toBe('')
    expect(previewFormatCss(DEFAULT_PREVIEW_FORMAT)).toBe('')
    const css = previewFormatCss({ borders: true, boldHeadings: true, spacing: 'relaxed' })
    expect(css).toMatch(/border: 1px solid/)
    expect(css).toMatch(/tr\.ab td[^{]*\{ font-weight: bold/)
    expect(css).toMatch(/line-height: 1\.6/)
    const html = buildPreviewHtml(filing(), { format: { borders: true, boldHeadings: false, spacing: 'compact' }, printBar: false })
    expect(html).toContain('border: 1px solid #999')
    expect(html).toContain('line-height: 1.2')
    expect(html).not.toContain('h2, h3, .tblhead')
  })

  it('normalises a stored or requested format against the defaults', () => {
    expect(normalizePreviewFormat(undefined)).toEqual(DEFAULT_PREVIEW_FORMAT)
    expect(normalizePreviewFormat({ borders: true, spacing: 'huge', boldHeadings: 'yes' })).toEqual({ ...DEFAULT_PREVIEW_FORMAT, borders: true })
    expect(normalizePreviewFormat({ borders: false, boldHeadings: true, spacing: 'compact' })).toEqual({ borders: false, boldHeadings: true, spacing: 'compact' })
  })
})
