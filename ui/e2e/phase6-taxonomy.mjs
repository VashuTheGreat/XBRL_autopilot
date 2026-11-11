// Phase 6 (ADR-0010): the New Filing wizard's taxonomy choice and an Ind AS 2017 filing whose engine authority comes
// from the sidecar route. Drives the running dev app through CDP; prints PASS/FAIL per check and exits 1 on failure.
// Usage: node e2e/phase6-taxonomy.mjs <port> <screenshotDir>
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
const [port, outDir] = process.argv.slice(2)
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
await clickText('New filing')
await waitFor(`!!document.querySelector('[role=dialog]')`, 'wizard')
const choices = await ev(`[...document.querySelectorAll('[role=dialog] [role=radio]')].map((b) => b.dataset.testid + ':' + b.getAttribute('aria-checked')).join(' ')`)
check('wizard offers C&I 2016 (default) and Ind AS 2017', choices === 'taxonomy-ci-2016:true taxonomy-ind-as-2017:false', choices)
await ev(`document.querySelector('[data-testid="taxonomy-ind-as-2017"]').click()`)
await waitFor(`document.querySelector('[data-testid="taxonomy-ind-as-2017"]').getAttribute('aria-checked') === 'true'`, 'Ind AS selected')
await setValue('[role=dialog] input[placeholder="Acme Private Limited"]', 'Dixon Global Private Limited')
await setValue('[role=dialog] input[placeholder="U72200KA2010PTC123456"]', 'U51900UP2010PTC042400')
await shot('p6-01-wizard-ind-as.png')
await clickText('Create filing')
await waitFor(`!document.querySelector('[role=dialog]')`, 'wizard closed', 180000)

const summary = await ev('window.xap.project.current()')
check('project is Ind AS 2017', summary?.taxonomy === 'ind-as-2017', summary?.taxonomy)
const footer = await ev(`document.querySelector('[data-testid="filing-taxonomy"]')?.textContent`)
check('status bar names the taxonomy', footer === 'Ind AS 2017', footer)
const elrs = await ev('window.xap.project.elrs()')
const codes = (elrs?.value ?? []).map((e) => e.code)
check('statement list is the Ind AS one (66 ELRs incl. 110000 and 700300)', codes.length === 66 && codes.includes('110000') && codes.includes('700300'), `${codes.length} ELRs`)
await waitFor(`document.body.innerText.includes('Balance sheet')`, 'explorer tree')
const xml = await ev('window.xap.editor.xml()')
const text = xml?.value?.xml ?? xml?.value ?? ''
check('XML uses the Ind AS schemaRef', typeof text === 'string' && text.includes('/V3XBRL/2017/07/16/Taxonomy/Ind/in-ci-ent-2017-03-31.xsd'))
check('XML reports the company name as an in-ca fact', typeof text === 'string' && /<in-ca:NameOfCompany [^>]*>Dixon Global Private Limited</.test(text))
await shot('p6-02-ind-as-filing.png')
check('no renderer errors', errors.length === 0, errors.join(' | '))
ws.close()
process.exit(failed ? 1 : 0)
