// Phase 7: import an existing XBRL instance (Dixon, Ind AS, Webtel) through the welcome screen's Import XBRL dialog,
// check the import report (round trip proven fact by fact) and the opened filing. The native file dialog is bypassed with the store's path argument (dev test hook).
// Usage: node e2e/phase7-import.mjs <port> <screenshotDir> <instance.xml>
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
const [port, outDir, instance] = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let targets
for (let i = 0; i < 120; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === 'page')) break } catch {} await sleep(500) }
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let id = 0; const pending = new Map(); const errors = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error ' + m.params.args.map((a) => a.value ?? a.description).join(' '))
})
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description }
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(outDir, name), Buffer.from(s.result.data, 'base64')); console.log('screenshot', name) }
const waitFor = async (expr, label, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(250) } throw new Error('timeout: ' + label) }
await send('Runtime.enable')

// React-controlled inputs need the native setter + an input event
const setValue = (sel, value) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return el.value })()`)
const clickText = (text) => ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().includes(${JSON.stringify(text)})); if (!b) return 'missing'; b.click(); return 'ok' })()`)

let failed = 0
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`); if (!ok) failed++ }

await waitFor(`document.body.innerText.includes('Recent filings')`, 'welcome screen', 120000)
// the dev renderer may reload once right after start: click until the dialog is there
await waitFor(`(document.querySelector('[role=dialog][aria-label="Import XBRL instance"]') || void document.querySelector('[data-testid="welcome-import-xbrl"]')?.click()) && true`, 'import dialog')
const modes = await ev(`[...document.querySelectorAll('[role=dialog] [role=radio]')].map((b) => b.dataset.testid + ':' + b.getAttribute('aria-checked')).join(' ')`)
check('import dialog offers both modes, "open that filing" first', modes === 'import-mode-both:true import-mode-next:false', modes)
await shot('p7-01-import-dialog.png')
// the file dialog is native: hand the path to the same store action the button calls
await ev(`window.__xap_test__.project.getState().importXbrl('both', ${JSON.stringify(instance)})`)
await waitFor(`!!document.querySelector('[data-testid="import-report"]')`, 'import report', 240000)
check('round trip proven in the report', await ev(`!!document.querySelector('[data-testid="round-trip-ok"]')`), await ev(`document.querySelector('[data-testid="round-trip-ok"],[data-testid="round-trip-diff"]')?.textContent`))
check('all facts imported', (await ev(`document.querySelector('[data-testid="import-imported"]')?.textContent`)) === '2,666')
check('conventions table compares their file with ours', (await ev(`document.querySelectorAll('[data-testid="conventions"] tbody tr').length`)) >= 6)
await shot('p7-02-import-report.png')
await clickText('Close')
const s = await ev('window.xap.project.current()')
check('project is the Dixon Ind AS filing', s?.taxonomy === 'ind-as-2017' && s?.company?.name === 'DIXON GLOBAL PRIVATE LIMITED' && s?.factCount > 2000, `${s?.taxonomy} ${s?.company?.name} ${s?.factCount} facts`)
await waitFor(`window.__xap_test__.project.getState().elrs.length === 66`, 'Ind AS statement list')
check('statement list is Ind AS (66)', true)
await shot('p7-03-dixon-open.png')

check('no renderer errors', errors.length === 0, errors.join(' | '))
ws.close()
process.exit(failed ? 1 : 0)
