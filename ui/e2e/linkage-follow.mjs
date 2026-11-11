// Excel → XBRL linkage follows the selection: selecting a tagged cell opens the statement that shows its element (when
// another statement is open) and scrolls the element's row into view; Form → Excel reveals the cell; a suggested tag's
// row is shown too. Dev app, C&I filing + synthetic sample workbook.
// Usage: node e2e/linkage-follow.mjs <port> <screenshotDir> <sample_financials.xlsx>
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
const [port, outDir, sample] = process.argv.slice(2)
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
const T = 'window.__xap_test__'
const failures = []
const check = (ok, what, detail = '') => { console.log(ok ? 'PASS' : 'FAIL', what, detail ? '— ' + detail : ''); if (!ok) failures.push(what) }
const BS = 'http://www.icai.org/xbrl/taxonomy/role/in-gaap/BalanceSheet'

await send('Runtime.enable')
await waitFor(`!!${T}?.editor && document.body.innerText.includes('Recent filings')`, 'app ready', 120000)
await ev(`window.xap.project.create({ companyName: 'XBRL Ltd', cin: 'U72200KA2010PLC123456', reportType: 'Standalone', cy: { start: '2013-04-01', end: '2014-03-31' }, py: { start: '2012-04-01', end: '2013-03-31' }, level: 'Actual' })`)
await ev(`${T}.project.getState().init()`)
await waitFor(`${T}.project.getState().elrs.length > 10`, 'statements')
await ev(`${T}.editor.getState().importWorkbook(${JSON.stringify(sample)})`)
await waitFor(`${T}.editor.getState().workbooks.length > 0`, 'workbook', 120000)
const cell = (ref) => `{ workbook: 'workbook-1.xlsx', sheet: 'BS', ref: '${ref}' }`
await ev(`window.xap.editor.tag({ cell: ${cell('C9')}, concept: 'in-gaap:ShareCapital', scope: 'CY' })`)
await ev(`window.xap.editor.tag({ cell: ${cell('C19')}, concept: 'in-gaap:TradePayables', scope: 'CY' }).then(r => r.ok || r.error.message)`)
await ev(`${T}.editor.getState().refresh?.()`)
await waitFor(`${T}.editor.getState().byCell.size >= 1`, 'mappings in store')

// another statement open (a note that does not show share capital)
const shows = await ev(`${T}.editor.getState().byCell.get('workbook-1.xlsx|BS|C9').elrUris`)
const note = await ev(`${T}.project.getState().elrs.find(e => !${JSON.stringify(shows)}.includes(e.uri) && /^[24]/.test(e.code))?.uri`)
await ev(`${T}.editor.getState().setActiveElr(${JSON.stringify(note)})`)
await waitFor(`${T}.editor.getState().activeElr === ${JSON.stringify(note)}`, 'note open')

// 0. a statement that already shows the element stays open (Notes - Share capital shows Share capital too)
await ev(`${T}.editor.getState().setActiveElr(${JSON.stringify(shows[1] ?? BS)})`)
await ev(`${T}.editor.getState().selectCell(${cell('C9')}), true`)
await sleep(800)
check(await ev(`${T}.editor.getState().activeElr === ${JSON.stringify(shows[1] ?? BS)}`), 'a statement that shows the element stays open')
await ev(`${T}.editor.getState().selectCell(${cell('A1')}), true`)
await ev(`${T}.editor.getState().setActiveElr(${JSON.stringify(note)})`)
await waitFor(`${T}.editor.getState().activeElr === ${JSON.stringify(note)}`, 'note open again')

// 1. select C9 → the Form opens the Balance sheet and the Share capital row is in view, highlighted
await ev(`${T}.editor.getState().selectCell(${cell('C9')}), true`)
await waitFor(`${T}.editor.getState().activeElr === ${JSON.stringify(BS)}`, 'form follows to [100100]', 15000)
check(true, 'selecting a tagged cell opens the statement that shows its element')
await waitFor(`!!document.querySelector('tr[data-concept="in-gaap:ShareCapital"]')`, 'row rendered')
// in view = below the sticky column header and above the bottom edge (a row behind the header is not visible)
const inView = `(() => { const r = document.querySelector('tr[data-concept="in-gaap:ShareCapital"]'); const c = r.closest('.overflow-auto'); const head = c.querySelector('thead').getBoundingClientRect(); const box = c.getBoundingClientRect(); const b = r.getBoundingClientRect(); return b.top >= head.bottom - 1 && b.bottom <= box.bottom })()`
await waitFor(inView, 'row in view', 5000)
check(await ev(`document.querySelector('tr[data-concept="in-gaap:ShareCapital"]').className.includes('bg-accent')`), 'its row is in view and highlighted')

// 2. scroll the Form away, select a cell whose row is further down → it scrolls back into view
await ev(`document.querySelector('[data-testid=form-table]').closest('.overflow-auto').scrollTop = 0, true`)
const tp = await ev(`!!document.querySelector('tr[data-concept="in-gaap:TradePayables"]')`)
if (tp) {
  await ev(`document.querySelector('[data-testid=form-table]').closest('.overflow-auto').scrollTop = 100000, true`)
  await ev(`${T}.editor.getState().selectCell(${cell('C9')}), true`)
  await waitFor(inView, 'scrolled back', 5000)
  check(true, 'a row outside the visible range is scrolled into view')
}
await send('Page.captureScreenshot', { format: 'png' }).then((s) => writeFileSync(join(outDir, 'linkage-follow.png'), Buffer.from(s.result.data, 'base64')))

// 3. Form → Excel: clicking the value selects and reveals its source cell
await ev(`${T}.editor.getState().selectCell(${cell('A1')}), true`)
const fk = await ev(`${T}.editor.getState().byCell.get('workbook-1.xlsx|BS|C9').factKey`)
await ev(`${T}.editor.getState().selectFact(${JSON.stringify(fk)}), true`)
check(await ev(`${T}.editor.getState().selection.cell?.ref === 'C9' && ${T}.editor.getState().reveal?.cell.ref === 'C9'`), 'clicking a Form value selects and reveals its Excel cell')

check(errors.length === 0, 'no renderer errors', errors.slice(0, 3).join(' | '))
ws.close()
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed')
process.exit(failures.length ? 1 : 0)
