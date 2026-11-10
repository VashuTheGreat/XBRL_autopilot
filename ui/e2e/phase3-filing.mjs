// Drives the running app through CDP: welcome → New filing wizard → create → explorer/title/status checks.
// Usage: node e2e-phase3.mjs <port> <screenshotDir>
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

await waitFor(`document.body.innerText.includes('Recent filings')`, 'welcome screen')
console.log('welcome:', await ev(`document.querySelector('h1')?.textContent`), '| title:', await ev('document.title'))
await shot('01-welcome.png')

console.log('click New filing:', await clickText('New filing'))
await waitFor(`!!document.querySelector('[role=dialog]')`, 'wizard')
console.log('wizard defaults:', await ev(`[...document.querySelectorAll('[role=dialog] input[type=date]')].map((i) => i.value).join(' | ')`))
// invalid CIN first → inline error
await setValue('[role=dialog] input[placeholder="U72200KA2010PTC123456"]', 'U123')
console.log('cin error shown:', await ev(`document.querySelector('[role=dialog]').innerText.includes('A CIN has 21 characters')`))
await setValue('[role=dialog] input[placeholder="Acme Private Limited"]', 'Sharma Textiles Private Limited')
await setValue('[role=dialog] input[placeholder="U72200KA2010PTC123456"]', 'U17110DL2012PTC234567')
await shot('02-wizard.png')
console.log('click Create:', await clickText('Create filing'))
await waitFor(`!document.querySelector('[role=dialog]')`, 'wizard closed')
await waitFor(`document.body.innerText.includes('Balance sheet')`, 'ELR tree loaded')

const summary = await ev('window.xap.project.current()')
console.log('summary:', JSON.stringify({ company: summary.company, fy: summary.fyLabel, dirty: summary.dirty, facts: summary.factCount, level: summary.level }))
console.log('status bar:', await ev(`document.querySelector('footer').innerText.replace(/\\n/g, ' | ')`))
console.log('explorer groups:', await ev(`[...document.querySelectorAll('[role=tree] [aria-expanded]')].map((b) => b.textContent).join(' ; ')`))
const elrs = await ev('window.xap.project.elrs()')
console.log('elrs:', elrs.ok, elrs.value.length, elrs.value.slice(0, 3).map((e) => `[${e.code}] ${e.title}`).join(' / '))
await shot('03-filing-open.png')

// settings panel renders; key never exposed
await ev(`document.querySelector('button[aria-label="Settings"]').click()`)
await waitFor(`document.body.innerText.includes('Groq API key')`, 'settings')
const st = await ev('window.xap.settings.get()')
console.log('settings:', JSON.stringify(st), '| contains gsk_:', JSON.stringify(st).includes('gsk_'))
await shot('04-settings.png')

// recovery: autosave by blur is wired in main; call the window blur path indirectly isn't possible from the page,
// so just check that the recovery list is reachable
console.log('recovery list:', JSON.stringify(await ev('window.xap.project.recovery()')))
console.log('renderer errors:', errors.length ? errors : 'none')
ws.close()
