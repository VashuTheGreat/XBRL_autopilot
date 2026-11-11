// Phase 8: AI auto-tagging on the real DGPL workbook (Ind AS, lakhs): Auto-tag → amber suggestions → inspector
// Accept / Reject (button clicks) → "Accept all ≥ 90%" → the Form shows the accepted figures. LLM off (no AI consent),
// so the client workbook never leaves the machine. The native file dialog is bypassed through the store's path argument.
// Usage: node e2e/phase8-autotag.mjs <port> <screenshotDir> <dgpl.xls>
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
const [port, outDir, workbook] = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let targets
for (let i = 0; i < 240; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === 'page' && t.url.startsWith('http'))) break } catch {} await sleep(500) }
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0; const pending = new Map(); const errors = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.slice(0, 300) || m.params.exceptionDetails.text)
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error ' + m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300))
})
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description }
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(outDir, name), Buffer.from(s.result.data, 'base64')); console.log('screenshot', name) }
const waitFor = async (expr, label, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(300) } throw new Error('timeout: ' + label) }
const T = 'window.__xap_test__'
const failures = []
const check = (ok, what, detail = '') => { console.log(ok ? 'PASS' : 'FAIL', what, detail ? '— ' + detail : ''); if (!ok) failures.push(what) }
// Selects a cell the way the Form → Excel link does (store select + reveal: the grid scrolls to it). DGPL's value
// columns (I, L) are off-screen in the narrow Excel pane, and the canvas-click helper only reaches visible cells;
// real canvas clicks are covered by phase4-editor.mjs. Accept / Reject below are real DOM clicks.
async function selectCell(sheet, ref) {
  await ev(`(() => { const c = { workbook: 'workbook-1.xls', sheet: ${JSON.stringify(sheet)}, ref: '${ref}' }; const s = ${T}.editor.getState(); s.revealCell(c); s.selectCell(c); return true })()`)
  await waitFor(`${T}.editor.getState().selection.cell?.ref === '${ref}'`, 'select ' + ref, 10000)
  await sleep(600)
}
const mapping = (sheet, ref) => ev(`JSON.stringify(${T}.editor.getState().mappings.find(m => m.cell.sheet === ${JSON.stringify(sheet)} && m.cell.ref === '${ref}') ?? null)`).then(JSON.parse)
const count = (status, min = 0) => ev(`${T}.editor.getState().mappings.filter(m => m.status === '${status}' && (m.confidence ?? 1) >= ${min}).length`)
const BS = 'IND AS BS '

await send('Runtime.enable')
await waitFor(`!!${T}?.editor && document.body.innerText.includes('Recent filings')`, 'app ready', 120000)

// 1. the Dixon filing: Ind AS 2017, FY 2025-26, in lakhs
const created = await ev(`window.xap.project.create({ taxonomy: 'ind-as-2017', companyName: 'DIXON GLOBAL PRIVATE LIMITED', cin: 'U51900UP2010PTC042400', reportType: 'Standalone', cy: { start: '2025-04-01', end: '2026-03-31' }, py: { start: '2024-04-01', end: '2025-03-31' }, level: 'Lakhs' }).then(r => r.ok || JSON.stringify(r.error))`)
check(created === true, 'Ind AS filing created', String(created))
await ev(`${T}.project.getState().init()`)
await waitFor(`!!${T}.project.getState().summary`, 'summary in store')

// 2. import DGPL (.xls through the sidecar) and run Auto-tag from the Excel pane's button
await ev(`${T}.editor.getState().importWorkbook(${JSON.stringify(workbook)})`)
await waitFor(`!!${T}?.univer && document.querySelector('[data-testid=univer-host] canvas')`, 'univer rendered', 120000)
await sleep(1500)
await waitFor(`!!document.querySelector('[data-testid=auto-tag]')`, 'Auto-tag button')
await ev(`document.querySelector('[data-testid=auto-tag]').click(), true`)
await waitFor(`${T}.editor.getState().mappings.filter(m => m.status === 'suggested').length > 100`, 'suggestions', 180000)
const suggested = await count('suggested')
check(suggested > 200, 'auto-tag stores suggestions (amber cells)', `${suggested} suggested`)
check((await count('approved')) === 0, 'no cell is tagged before the user accepts')
const factCount = await ev(`window.xap.project.current().then(s => s.factCount)`)
check(true, 'filing facts before accepting', String(factCount))

// 3. the inspector on a suggested cell: Trade Receivables (current) on the balance sheet, then Accept
await ev(`${T}.univer.getActiveWorkbook().getSheetByName(${JSON.stringify(BS)}).activate(), true`)
await sleep(800)
await shot('p8-01-suggestions.png')
await selectCell(BS, 'I24')
await waitFor(`!!document.querySelector('[data-testid=suggestion]')`, 'suggestion in inspector', 10000)
const insp = await ev(`document.querySelector('[data-testid=inspector]').innerText.replace(/\\n/g, ' ')`)
check(/Trade receivables, current/i.test(insp) && /\d+%/.test(insp), 'inspector shows the suggested element and its confidence', insp)
await shot('p8-02-inspector-suggestion.png')
await ev(`document.querySelector('[data-testid=accept-suggestion]').click(), true`)
await waitFor(`${T}.editor.getState().mappings.some(m => m.cell.ref === 'I24' && m.status === 'approved')`, 'I24 accepted', 15000)
const tr = await mapping(BS, 'I24')
check(tr?.fact.concept === 'ind-as:TradeReceivablesCurrent' && tr?.origin === 'exact' && tr?.confidence >= 0.9 && tr?.factKey, 'Accept tags the cell, keeping origin and confidence', JSON.stringify([tr?.fact, tr?.origin, tr?.confidence, tr?.value]))

// 4. Reject a suggestion (Cash and cash equivalents, I25): it turns red and is not tagged
await selectCell(BS, 'I25')
await waitFor(`!!document.querySelector('[data-testid=reject-suggestion]')`, 'reject button', 10000)
await ev(`document.querySelector('[data-testid=reject-suggestion]').click(), true`)
await waitFor(`${T}.editor.getState().mappings.some(m => m.cell.ref === 'I25' && m.cell.sheet === ${JSON.stringify(BS)} && m.status === 'rejected')`, 'I25 rejected', 15000)
check(true, 'Reject marks the suggestion rejected')

// 5. Accept all ≥ 90%
const sure = await count('suggested', 0.9)
await waitFor(`!!document.querySelector('[data-testid=accept-all]')`, 'accept-all button')
await ev(`document.querySelector('[data-testid=accept-all]').click(), true`)
await waitFor(`${T}.editor.getState().mappings.filter(m => m.status === 'approved').length > ${Math.floor(sure / 2)}`, 'accept all', 120000)
await sleep(1500)
const approved = await count('approved')
const leftSure = await count('suggested', 0.9)
check(approved >= sure * 0.8, 'Accept all ≥ 90% tags the confident suggestions', `${sure} at ≥ 90% → ${approved} approved, ${leftSure} left (could not be tagged)`)
check((await mapping(BS, 'I25'))?.status === 'rejected', 'a rejected suggestion stays rejected')
await shot('p8-03-accepted.png')

// 6. the Form shows the accepted figures (Balance sheet: Total assets 1,904.45 lakhs)
await ev(`document.querySelector('button[aria-label="Filing explorer"]').click()`)
await sleep(800)
const bsUri = await ev(`${T}.project.getState().elrs.find(e => e.code === '110000')?.uri`)
await ev(`${T}.editor.getState().setActiveElr(${JSON.stringify(bsUri)})`)
await waitFor(`!!document.querySelector('[data-testid=form-table]')`, 'form', 30000)
await sleep(800)
const assets = await ev(`[...document.querySelectorAll('[data-testid=form-table] tr')].find(tr => /^(total )?assets$/i.test((tr.cells[0]?.textContent ?? '').trim()))?.innerText.replace(/\\s+/g, ' ')`)
check(/1,904\.45/.test(assets ?? ''), 'Form shows the accepted Total assets 1,904.45', assets)
await shot('p8-04-form.png')

check(errors.length === 0, 'no renderer errors', errors.join(' | '))
ws.close()
if (failures.length) { console.error('FAILED:', failures); process.exit(1) }
console.log('ALL PASS')
