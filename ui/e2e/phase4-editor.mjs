// Phase 4 E2E (dev build, window.__xap_test__): import → select cell → taxonomy double-click → form/xml linkage.
// Usage: node e2e-phase4.mjs <port> <shotsDir> <samplePath>
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
const [port, outDir, sample] = process.argv.slice(2)
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
// Real mouse clicks on the Univer canvas, positioned from Univer's own layout skeleton.
const mouseClick = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); await sleep(350) }
async function clickCell(ref) {
  const p = await ev(`(() => {
    const ws = ${T}.univer.getActiveWorkbook().getActiveSheet(); const rg = ws.getRange('${ref}'); const r = rg.getRow(), c = rg.getColumn();
    const sk = ws.getSkeleton(); const cv = [...document.querySelectorAll('[data-testid=univer-host] canvas')].map(c => c.getBoundingClientRect()).filter(r => r.width > 0 && r.left >= 0).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const colAcc = sk.columnWidthAccumulation, rowAcc = sk.rowHeightAccumulation;
    const left = (c ? colAcc[c - 1] : 0), top = (r ? rowAcc[r - 1] : 0);
    return { x: cv.left + sk.rowHeaderWidth + left + (colAcc[c] - left) / 2, y: cv.top + sk.columnHeaderHeight + top + (rowAcc[r] - top) / 2 }
  })()`)
  await mouseClick(p.x, p.y)
  const got = await ev(`${T}.editor.getState().selection.cell?.ref`)
  if (got !== ref) throw new Error('click did not select ' + ref + ' (got ' + got + ' at ' + JSON.stringify(p) + ' debug ' + (await ev(`(() => { const ws = ${T}.univer.getActiveWorkbook().getActiveSheet(); const sk = ws.getSkeleton(); return JSON.stringify({ rh: sk.rowHeaderWidth, ch: sk.columnHeaderHeight, col0: sk.columnWidthAccumulation.slice(0,4), row0: sk.rowHeightAccumulation.slice(0,10), canvases: [...document.querySelectorAll('[data-testid=univer-host] canvas')].map(c => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }) }) })()`)) + ')')
  return 'skeleton'
}
await send('Runtime.enable')
await waitFor(`!!${T}?.editor && document.body.innerText.includes('Recent filings')`, 'app ready')

// 1. filing for the sample (FY 2013-14, rupees)
const created = await ev(`window.xap.project.create({ companyName: 'XBRL Ltd', cin: 'U72200KA2010PLC123456', reportType: 'Standalone', cy: { start: '2013-04-01', end: '2014-03-31' }, py: { start: '2012-04-01', end: '2013-03-31' }, level: 'Actual' }).then(r => r.ok)`)
console.log('filing created:', created)
await ev(`${T}.project.getState().init()`)
await waitFor(`!!${T}.project.getState().summary`, 'summary in store')

// 2. import the workbook through the store (no native dialog)
await ev(`${T}.editor.getState().importWorkbook(${JSON.stringify(sample)})`)
await waitFor(`!!${T}?.univer && document.querySelector('[data-testid=univer-host] canvas')`, 'univer rendered')
await sleep(1500)
console.log('workbooks:', await ev(`${T}.editor.getState().workbooks.map(w => w.fileName + ':' + w.sheets.map(s => s.name).join('/')).join()`))
await shot('p4-01-imported.png')

// 3. select C9 through Univer (fires our SelectionChanged wiring)
console.log('click C9 via', await clickCell('C9'))
console.log('inspector before:', await ev(`document.querySelector('[data-testid=inspector]').innerText.replace(/\\n/g,' ')`))

// 4. taxonomy: search + double-click
await ev(`document.querySelector('button[aria-label="Taxonomy"]').click()`)
await waitFor(`!!document.querySelector('[data-testid=taxonomy-search]')`, 'taxonomy panel')
const setSearch = (q) => ev(`(() => { const el = document.querySelector('[data-testid=taxonomy-search]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(q)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
await setSearch('share capital')
await waitFor(`[...document.querySelectorAll('[role=option]')].length > 0`, 'search results')
console.log('top hits:', await ev(`[...document.querySelectorAll('[role=option]')].slice(0,3).map(li => li.querySelector('.font-mono').textContent).join(' | ')`))
const dbl = `(() => { const li = [...document.querySelectorAll('[role=option]')].find(x => x.querySelector('.font-mono').textContent === 'in-gaap:ShareCapital'); li.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true })()`
await ev(dbl)
await waitFor(`${T}.editor.getState().mappings.length === 1`, 'C9 tagged')
// PY: select D9 and double-click the same element
await clickCell('D9')
await ev(dbl)
await waitFor(`${T}.editor.getState().mappings.length === 2`, 'D9 tagged')
// and Revenue from operations on the PL sheet (C6) via search
await ev(`${T}.univer.getActiveWorkbook().getSheetByName('PL').activate(), true`)
await sleep(600)
await clickCell('C6')
console.log('selected sheet:', await ev(`${T}.editor.getState().selection.cell?.sheet`))
await setSearch('revenue from operations')
await waitFor(`[...document.querySelectorAll('[role=option] .font-mono')].some(x => x.textContent === 'in-gaap:RevenueFromOperations')`, 'revenue hit')
await ev(`(() => { const li = [...document.querySelectorAll('[role=option]')].find(x => x.querySelector('.font-mono').textContent === 'in-gaap:RevenueFromOperations'); li.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true })()`)
await waitFor(`${T}.editor.getState().mappings.length === 3`, 'C6 tagged')
console.log('mappings:', await ev(`JSON.stringify(${T}.editor.getState().mappings.map(m => [m.cell.sheet + '!' + m.cell.ref, m.fact.concept, m.fact.scope, m.value, m.status]))`))
console.log('inspector after:', await ev(`document.querySelector('[data-testid=inspector]').innerText.replace(/\\n/g,' ')`))

// 5. back to BS: form shows values + source chips
await ev(`${T}.univer.getActiveWorkbook().getSheetByName('BS').activate(), true`)
await ev(`document.querySelector('button[aria-label="Filing explorer"]').click()`)
await sleep(800)
console.log('form share capital row:', await ev(`[...document.querySelectorAll('[data-testid=form-table] tr')].find(tr => /share capital/i.test(tr.cells[0]?.textContent ?? '') && /C9/.test(tr.textContent))?.innerText.replace(/\\s+/g,' ')`))
await shot('p4-02-tagged-form.png')

// 6. form → excel: click the PY value of share capital, Excel selection should follow
await ev(`(() => { const tr = [...document.querySelectorAll('[data-testid=form-table] tr')].find(t => /D9/.test(t.textContent)); [...tr.querySelectorAll('button')].find(b => /D9/.test(b.textContent)).click(); return true })()`)
await waitFor(`${T}.editor.getState().selection.cell?.ref === 'D9'`, 'reveal D9 from form')
console.log('form→excel selection:', await ev(`JSON.stringify(${T}.editor.getState().selection.cell)`))

// 7. XML tab: selected fact's line highlighted
await ev(`[...document.querySelectorAll('[role=tab]')].find(t => t.textContent === 'XML').click()`)
await waitFor(`!!document.querySelector('[data-testid=xml-editor] .monaco-editor') && !!${T}.editor.getState().xml`, 'monaco xml', 60000)
await sleep(1500)
const xs = await ev(`(() => { const s = ${T}.editor.getState(); const line = s.xml.factLines[s.selection.factKey]; return JSON.stringify({ line, text: s.xml.xml.split('\\n')[line-1]?.trim(), highlighted: document.querySelectorAll('.xap-xml-line').length, facts: Object.keys(s.xml.factLines).length, errors: s.xml.errorCount }) })()`)
console.log('xml:', xs)
await shot('p4-03-xml.png')
console.log('status bar:', await ev(`document.querySelector('footer:last-of-type')?.innerText.replace(/\\n/g,' | ')`))
console.log('renderer errors:', errors.length ? errors : 'none')
ws.close()
