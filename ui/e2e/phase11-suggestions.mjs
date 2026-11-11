// Phase 11 step 3b (ADR-0013): auto-tagging's table and "also reported as" suggestions in the app. Dev app, Ind AS
// filing + the DGPL workbook (.xls); no AI (LLM off, no consent).
// Auto-tag → suggested blocks (dashed outline) and nothing tagged; FA: the block bar (table, confidence) → Accept tags
// its cells (origin table); Change in Equity: Review… opens "Map as table" prefilled → Map cells; the second block is
// rejected and not suggested again; Equity share capital (I39) carries a suggested "also" fact that Accept all ≥ 90%
// leaves alone, accepted afterwards from the inspector.
// Usage: node e2e/phase11-suggestions.mjs <port> <screenshotDir> "<path>/data/BS DGPL Mar-2026-V1.xls"
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
const [port, outDir, dgpl] = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let targets
for (let i = 0; i < 240; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === 'page' && t.url.startsWith('http'))) break } catch {} await sleep(500) }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0; const pending = new Map(); const errors = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 300) || m.params.exceptionDetails.text)
})
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description }
const waitFor = async (expr, label, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(300) } throw new Error('timeout: ' + label) }
const shot = (name) => send('Page.captureScreenshot', { format: 'png' }).then((s) => writeFileSync(join(outDir, name), Buffer.from(s.result.data, 'base64')))
const T = 'window.__xap_test__'
const failures = []
const check = (ok, what, detail = '') => { console.log(ok ? 'PASS' : 'FAIL', what, detail ? '— ' + detail : ''); if (!ok) failures.push(what) }
const click = (sel) => ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b || b.disabled) return false; b.click(); return true })()`)
const state = `${T}.editor.getState()`
const open = `${state}.blockSuggestions.filter((b) => b.status === 'suggested')`

const P = 'ind-as:'
const PPE_TABLE = '400600:DisclosureOfPropertyPlantAndEquipmentTable'
const SOCIE = '400200:StatementOfChangesInEquityTable'

await send('Runtime.enable')
await send('Page.enable')
await waitFor(`!!${T}?.editor && !!${T}?.tables && document.body.innerText.includes('Recent filings')`, 'app ready', 120000)
await ev(`window.xap.project.create({ taxonomy: 'ind-as-2017', companyName: 'Synthetic Pvt Ltd', cin: 'U72200KA2010PTC123456', reportType: 'Standalone', cy: { start: '2025-04-01', end: '2026-03-31' }, py: { start: '2024-04-01', end: '2025-03-31' }, level: 'Lakhs', statementPlaces: 2 })`)
await ev(`${T}.project.getState().init()`)
await waitFor(`${T}.project.getState().elrs.length > 50`, 'Ind AS statements', 60000)
await ev(`${state}.importWorkbook(${JSON.stringify(dgpl)})`)
await waitFor(`${state}.workbooks.length > 0`, 'workbook', 120000)
const SRC = await ev(`${state}.workbooks[0].source`)
const sheetName = (trimmed) => ev(`${state}.workbooks[0].sheets.find((s) => s.name.trim() === ${JSON.stringify(trimmed)}).name`)
const at = (sheet, ref) => `{ workbook: '${SRC}', sheet: ${JSON.stringify(sheet)}, ref: '${ref}' }`
const select = (sheet, ref) => ev(`${state}.selectCell(${at(sheet, ref)}), true`)
const FA = await sheetName('FA')
const CE = await sheetName('Change in Equity')
const BS = await sheetName('IND AS BS')

// 1. Auto-tag: block suggestions are stored, nothing is tagged
await click('[data-testid=auto-tag]')
await waitFor(`${open}.length > 0 && document.body.innerText.includes('dashed outline')`, 'auto-tag done', 180000)
const blocks = await ev(`${open}.map((b) => ({ sheet: b.cell.sheet, ref: b.cell.ref, tableId: b.tableId, confidence: b.confidence, cellCount: b.cellCount }))`)
check(blocks.length >= 3, 'auto-tag suggests table blocks', JSON.stringify(blocks.map((b) => `${b.sheet.trim()}!${b.ref} ${b.tableId.split(':')[0]} ${b.confidence}`)))
check(await ev(`${state}.mappings.every((m) => m.status !== 'approved')`), 'nothing is tagged before accepting')
const fa = blocks.find((b) => b.sheet === FA && b.tableId === PPE_TABLE)
check(!!fa && fa.cellCount > 30, 'FA is suggested as the PPE table', JSON.stringify(fa))
const ce = blocks.filter((b) => b.sheet === CE && b.tableId === SOCIE)
check(ce.length === 2, 'the two changes-in-equity years are suggested as the SOCIE table', JSON.stringify(ce))

// 2. FA: the block bar under a cell of the block, then Accept
await ev(`${T}.editor.setState({ activeSource: '${SRC}' }), true`)
await select(FA, 'E18')
await waitFor(`document.querySelector('[data-testid=block-suggestion]')?.dataset.range === '${fa.ref}'`, 'block bar', 10000)
const bar = await ev(`document.querySelector('[data-testid=block-suggestion]').innerText`)
check(/property, plant and equipment/i.test(bar) && bar.includes(`${Math.round(fa.confidence * 100)}%`), 'the bar names the table and its confidence', bar.replace(/\s+/g, ' '))
// a reveal right after a sheet change used to throw inside Univer and blank the window (2026-11-11)
await ev(`${T}.editor.getState().revealCell(${at(FA, 'E18')}), true`)
await sleep(800)
check(await ev(`!!document.querySelector('[data-testid=univer-host]') && !document.querySelector('[data-testid=error-retry]')`), 'an immediate reveal keeps the Excel view alive (no white window)')
await shot('phase11-block-suggestion.png')
await click('[data-testid=block-accept]')
await waitFor(`${state}.mappings.filter((m) => m.blockId && m.cell.sheet === ${JSON.stringify(FA)}).length > 30`, 'FA cells tagged', 30000)
const e18 = await ev(`${state}.byCell.get('${SRC}|${FA}|E18')`)
check(e18?.fact?.tableId === PPE_TABLE && e18?.value === '0.73' && e18?.origin === 'table' && e18?.confidence === fa.confidence, 'Accept: FA!E18 = PPE closing (computers, gross, CY) 0.73, origin table', JSON.stringify({ v: e18?.value, o: e18?.origin, c: e18?.confidence, f: e18?.fact }))
check(await ev(`!${open}.some((b) => b.cell.ref === '${fa.ref}' && b.cell.sheet === ${JSON.stringify(FA)})`), 'the accepted suggestion is closed')
await waitFor(`!document.querySelector('[data-testid=block-suggestion]')`, 'bar gone', 5000).catch(() => {})
check(await ev(`!document.querySelector('[data-testid=block-suggestion]')`), 'the bar goes away once the block is tagged')

// 3. Change in Equity, first year: Review… opens "Map as table" prefilled; Map cells accepts it as edited.
// The table opens only once the balance sheet's Other equity is entered (SR-L694-1): first accept those suggestions.
const otherEquity = await ev(`${state}.mappings.filter((m) => m.status === 'suggested' && m.fact.concept === '${P}OtherEquity').map((m) => m.id)`)
for (const mid of otherEquity) await ev(`${state}.acceptSuggestion(${JSON.stringify(mid)})`)
await waitFor(`${state}.mappings.filter((m) => m.status === 'approved' && m.fact.concept === '${P}OtherEquity').length === 2`, 'other equity tagged', 15000)
check(otherEquity.length === 2, 'Other equity (CY, PY) accepted first: it opens the changes-in-equity table', `${otherEquity.length} suggestions`)
const [ce1, ce2] = ce
const inside = (ref) => ref.split(':')[0].replace(/^([A-Z]+)(\d+)$/, (_, c, r) => `C${Number(r) + 1}`)
await select(CE, inside(ce1.ref))
await waitFor(`document.querySelector('[data-testid=block-suggestion]')?.dataset.range === '${ce1.ref}'`, 'CE bar', 10000)
await click('[data-testid=block-review]')
await waitFor(`!!document.querySelector('[data-testid=table-map-dialog]')`, 'dialog')
await waitFor(`document.querySelector('[data-testid=table-picker]')?.value === '${SOCIE}'`, 'table preselected', 15000)
await waitFor(`[...document.querySelectorAll('[data-testid=table-map-row] select[aria-label^="Line item"]')].filter((s) => s.value).length >= 3`, 'rows prefilled', 15000)
const prefilled = await ev(`[...document.querySelectorAll('[data-testid=table-map-row] select[aria-label^="Line item"]')].filter((s) => s.value).map((s) => s.value.split('|')[0].replace('${P}', ''))`)
check(prefilled.length >= 3, 'Review…: the dialog starts from the suggestion (table, rows, members)', prefilled.join(', '))
check(await ev(`document.querySelector('[role=dialog]')?.innerText.includes('Review the suggested table')`), 'the dialog says it reviews a suggestion')
await shot('phase11-block-review.png')
await click('[data-testid=table-apply]')
await waitFor(`!document.querySelector('[data-testid=table-map-dialog]')`, 'dialog closed', 20000)
await waitFor(`${state}.mappings.some((m) => m.blockId && m.cell.sheet === ${JSON.stringify(CE)})`, 'CE cells tagged', 15000)
const ceTags = await ev(`${state}.mappings.filter((m) => m.blockId && m.cell.sheet === ${JSON.stringify(CE)}).map((m) => ({ ref: m.cell.ref, origin: m.origin, dims: m.fact.dims.length }))`)
check(ceTags.length > 0 && ceTags.every((m) => m.origin === 'manual' && m.dims > 0), 'Map cells accepts it as a manual block of table values', JSON.stringify(ceTags))

// 4. the second year is rejected and not suggested again; tagged ranges aren't either
await select(CE, inside(ce2.ref))
await waitFor(`document.querySelector('[data-testid=block-suggestion]')?.dataset.range === '${ce2.ref}'`, 'CE2 bar', 10000)
await click('[data-testid=block-reject]')
await waitFor(`!document.querySelector('[data-testid=block-suggestion]')`, 'bar gone after reject', 10000)
check(await ev(`${state}.blockSuggestions.some((b) => b.status === 'rejected' && b.cell.ref === '${ce2.ref}')`), 'Reject keeps the block as rejected')
await click('[data-testid=auto-tag]')
await waitFor(`!${state}.autoTagging`, 'second run', 180000)
await sleep(500)
const again = await ev(`${open}.map((b) => b.cell.sheet.trim() + '!' + b.cell.ref)`)
check(!again.includes(`${CE.trim()}!${ce2.ref}`) && !again.includes(`${FA.trim()}!${fa.ref}`) && !again.includes(`${CE.trim()}!${ce1.ref}`), 'a re-run suggests neither the rejected block nor the tagged ones', JSON.stringify(again))

// 5. "also": Equity share capital's suggested share class — never in Accept all, accepted from the inspector
const i39 = `${state}.byCell.get('${SRC}|${BS}|I39')`
check(await ev(`${i39}?.status === 'suggested' && ${i39}.alsoSuggestedViews.some((a) => /Equity shares 1/i.test(a.memberLabels.join(' ')))`), 'I39 (Equity share capital) carries a suggested “also: Equity shares 1”')
await select(BS, 'I39')
await waitFor(`document.querySelector('[data-testid=inspector] [data-testid=also-suggested]')?.innerText.includes('(suggested)')`, 'inspector also chip on a suggestion', 10000)
check(true, 'the inspector shows the suggested also fact on the suggestion')
const before = await ev(`${state}.mappings.filter((m) => m.status === 'suggested' && m.alsoSuggested?.length).length`)
await click('[data-testid=accept-all]')
await waitFor(`${i39}?.status === 'approved'`, 'accept all', 60000)
const approvedAlso = await ev(`${state}.mappings.filter((m) => m.status === 'approved' && m.alsoViews.length).length`)
check(approvedAlso === 0, 'Accept all ≥ 90% files no “also” fact', `${before} suggestions carried one; ${approvedAlso} filed`)
check(await ev(`${i39}.alsoSuggested?.length === 1 && ${i39}.alsoViews.length === 0`), 'I39 is tagged; its also suggestion stays open')
await select(BS, 'I40')
await select(BS, 'I39')
await waitFor(`!!document.querySelector('[data-testid=also-accept]')`, 'also accept button', 10000)
await shot('phase11-also-suggested.png')
await click('[data-testid=also-accept]')
await waitFor(`${i39}?.alsoViews?.length === 1`, 'also filed', 10000)
const sc = await ev(i39)
check(sc.alsoViews[0].value === sc.value && /Equity shares 1/i.test(sc.alsoViews[0].memberLabels.join(' ')) && !sc.alsoSuggested, 'accepting it files the share-class fact with the same value', `${sc.value} / ${sc.alsoViews[0].value}`)
await waitFor(`document.querySelector('[data-testid=also-reported]')?.innerText.includes('Equity shares 1')`, 'filed chip', 5000).catch(() => {})
check(await ev(`document.querySelector('[data-testid=also-reported]')?.innerText.includes('Equity shares 1') && !document.querySelector('[data-testid=also-accept]')`), 'the inspector now shows it as filed')

check(errors.length === 0, 'no renderer errors', errors.slice(0, 3).join(' | '))
ws.close()
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed')
process.exit(failures.length ? 1 : 0)
