// Phase 9: live validation in the real app. C&I filing + sample workbook → a tag that leaves a problem → Problems panel
// (counts, rule coverage) → double-click locates the Excel cell and the statement → Fix clears it → MCA tool errors
// pasted, explained and linked to their element. The native dialogs are bypassed (store / textarea).
// Usage: node e2e/phase9-validation.mjs <port> <screenshotDir> <sample_financials.xlsx>
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
const failures = []
const check = (ok, what, detail = '') => { console.log(ok ? 'PASS' : 'FAIL', what, detail ? '— ' + detail : ''); if (!ok) failures.push(what) }

await send('Runtime.enable')
await waitFor(`!!${T}?.validation && document.body.innerText.includes('Recent filings')`, 'app ready', 120000)

// 1. C&I filing for the sample (FY 2013-14, rupees) and its workbook
const created = await ev(`window.xap.project.create({ companyName: 'XBRL Ltd', cin: 'U72200KA2010PLC123456', reportType: 'Standalone', cy: { start: '2013-04-01', end: '2014-03-31' }, py: { start: '2012-04-01', end: '2013-03-31' }, level: 'Actual' }).then(r => r.ok || JSON.stringify(r.error))`)
check(created === true, 'C&I filing created', String(created))
await ev(`${T}.project.getState().init()`)
await waitFor(`!!${T}.project.getState().summary`, 'summary in store')
await ev(`${T}.editor.getState().importWorkbook(${JSON.stringify(sample)})`)
await waitFor(`!!${T}?.univer && document.querySelector('[data-testid=univer-host] canvas')`, 'univer rendered', 120000)
await sleep(1000)

// 2. live validation: problems appear by themselves, counted in the status bar; the Problems tab shows rule coverage
await waitFor(`(${T}.validation.getState().view?.summary.errors ?? 0) > 0`, 'first validation run', 30000)
check(/\d+ errors/.test(await ev(`document.querySelector('[data-testid=status-problems]')?.innerText ?? ''`)), 'status bar counts the errors')
await ev(`[...document.querySelectorAll('[role=tab]')].find(b => b.textContent.startsWith('Problems')).click(), true`)
await waitFor(`!!document.querySelector('[data-testid=problems-panel]')`, 'problems panel')
const coverage = await ev(`document.querySelector('[data-testid=rule-coverage]')?.innerText ?? ''`)
check(/95\.\d% executable/.test(coverage), 'rule coverage of the taxonomy is shown', coverage)

// 3. tag share capital for the previous year only (D9): its total is missing → a problem on that cell
const sheet = await ev(`${T}.editor.getState().workbooks[0].sheets[0].name`)
const cell = { workbook: 'workbook-1.xlsx', sheet, ref: 'D9' }
const tagged = await ev(`window.xap.editor.tag({ cell: ${JSON.stringify(cell)}, concept: 'in-gaap:ShareCapital', scope: 'PY' }).then(r => r.ok || JSON.stringify(r.error))`)
check(tagged === true, 'D9 tagged as share capital (PY)', String(tagged))
await ev(`${T}.editor.getState().refresh?.()`)
const onD9 = `[...document.querySelectorAll('[data-testid=problem]')].filter(r => r.querySelector('[data-testid=problem-cell]')?.textContent.endsWith('!D9'))`
await waitFor(`${onD9}.length > 0`, 'problem on D9', 30000)
const d9Problems = await ev(`${onD9}.map(r => r.innerText.replace(/\\n/g, ' ').slice(0, 160))`)
check(d9Problems.length > 0, 'the problem names its source cell', d9Problems.join(' | '))
await shot('p9-01-problems.png')

// 4. double-click → the Excel cell is selected and the statement opens in the Form
await ev(`(() => { ${T}.editor.getState().selectCell({ workbook: 'workbook-1.xlsx', sheet: ${JSON.stringify(sheet)}, ref: 'A1' }); return true })()`)
await ev(`${onD9}[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true })), true`)
await waitFor(`${T}.editor.getState().selection.cell?.ref === 'D9'`, 'located D9', 10000)
check(true, 'double-click selects the Excel cell D9')
const elr = await ev(`${T}.editor.getState().activeElr`)
check(typeof elr === 'string' && elr.length > 0, 'double-click opens the statement in the Form', String(elr))
await shot('p9-02-located.png')

// 5. quick fix: the problem with a Fix button on D9 is resolved by the engine
const fixable = `${onD9}.find(r => r.querySelector('[data-testid=problem-fix]'))`
const hasFix = await ev(`!!${fixable}`)
check(hasFix, 'a quick fix is offered for the D9 problem')
if (hasFix) {
  const pid = await ev(`${fixable}.dataset.problemId`)
  const before = await ev(`${T}.validation.getState().view.problems.filter(p => p.cell?.ref === 'D9' && p.fix).length`)
  await ev(`${fixable}.querySelector('[data-testid=problem-fix]').click(), true`)
  await waitFor(`${T}.validation.getState().view.problems.filter(p => p.cell?.ref === 'D9' && p.fix).length < ${before}`, 'fix applied', 15000)
  check(!(await ev(`${T}.validation.getState().view.problems.some(p => p.id === ${JSON.stringify(pid)})`)), 'the fixed problem is gone after revalidation')
}

// 6. MCA tool errors: pasted, explained, linked to their element
await ev(`document.querySelector('[data-testid=mca-import]').click(), true`)
await waitFor(`!!document.querySelector('[data-testid=mca-import-text]')`, 'paste dialog')
const mcaText = "1) cvc-datatype-valid.1.2.1: 'abc' is not a valid value for 'decimal'.\\n2) cvc-type.3.1.3: The value 'abc' of element 'in-gaap:ShareCapital' is not valid."
await ev(`(() => { const el = document.querySelector('[data-testid=mca-import-text]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, "${mcaText}"); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
await ev(`document.querySelector('[data-testid=mca-import-submit]').click(), true`)
await waitFor(`document.querySelectorAll('[data-testid=problem][data-source=mca]').length === 2`, 'MCA problems', 15000)
check(true, 'two MCA errors listed (source filter switched to the MCA tool)')
await ev(`document.querySelector('[data-testid=problem][data-source=mca] button[title=Explain]').click(), true`)
await waitFor(`!!document.querySelector('[data-testid=problem-explanation]')`, 'explanation', 5000)
check(/Meaning:/.test(await ev(`document.querySelector('[data-testid=problem-explanation]').innerText`)), 'an MCA error is explained in plain language')
check(await ev(`${T}.validation.getState().view.problems.some(p => p.source === 'mca' && p.location?.concept === 'in-gaap:ShareCapital')`), 'the MCA error is linked to its element')
await shot('p9-03-mca.png')

check(errors.length === 0, 'no renderer errors', errors.slice(0, 3).join(' | '))
ws.close()
if (failures.length) { console.log(`\n${failures.length} check(s) failed`); process.exit(1) }
console.log('\nall checks passed')
