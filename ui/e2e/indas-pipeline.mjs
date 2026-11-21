// Vashu's Ind AS pipeline screen (docs/17), dev app, real sidecar: start screen → Start Ind AS filing → upload a workbook
// (/indas/transform, local) → Suggest tags (/indas/recommend) → accept top → company / auditor / signatories
// (synthetic values) → Generate (/indas/generateXML) → the XML is in the projects folder, or the MCA problems are listed.
// Usage: node e2e/indas-pipeline.mjs <port> <screenshotDir> <workbook.xls|xlsx>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const [port, outDir, workbook] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
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
const waitFor = async (expr, label, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(500) } throw new Error('timeout: ' + label) }
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(outDir, name), Buffer.from(r.result.data, 'base64')); console.log('  screenshot', name) }
const click = (testId) => ev(`(document.querySelector('[data-testid="${testId}"]')?.click(), !!document.querySelector('[data-testid="${testId}"]'))`)
const S = 'window.__xap_test__.indas.getState()'
const failures = []
const check = (ok, what, detail = '') => { console.log(ok ? 'PASS' : 'FAIL', what, detail ? '— ' + detail : ''); if (!ok) failures.push(what) }

await send('Runtime.enable')
await send('Page.enable')
await waitFor(`!!window.__xap_test__?.indas && !!document.querySelector('[data-testid="welcome-indas-start"]')`, 'start screen', 120000)
await waitFor(`window.xap.sidecar.status().then(s => s.state === 'ready')`, 'sidecar ready', 180000)
await shot('01-start-screen.png')
check(await ev(`document.body.innerText.includes('Saved projects')`), 'start screen lists the projects folder')

// 1. Financial statements
check(await click('welcome-indas-start'), 'Start Ind AS filing opens the pipeline')
await waitFor(`!!document.querySelector('[data-testid="indas-pipeline"]')`, 'pipeline screen')
await ev(`${S}.upload(${JSON.stringify(workbook)})`)
await waitFor(`${S}.busy === null`, 'transform', 240000)
if (!(await ev(`${S}.transform !== null`))) throw new Error('transform failed: ' + (await ev(`document.body.innerText.slice(0, 400)`)))
const sizes = await ev(`Object.fromEntries(Object.entries(${S}.transform.sheets).map(([k, v]) => [k, v.length]))`)
check(sizes.CANONICAL_BS > 0 && sizes.CANONICAL_PL > 0, 'workbook converted into canonical sheets', JSON.stringify(sizes))
await sleep(500)
await shot('02-financials.png')

// 2. Tagging
await ev(`${S}.setStep('tagging')`)
const lines = await ev(`${S}.rows.length`)
check(lines > 0, 'BS + PL lines with amounts to tag', `${lines} lines`)
const t0 = Date.now()
await ev(`${S}.suggest()`)
await waitFor(`${S}.busy === null`, 'suggestions', 600000)
const withSuggestions = await ev(`${S}.rows.filter(r => r.suggestions.length > 0).length`)
check(withSuggestions > lines / 2, 'suggestions arrive for most lines', `${withSuggestions}/${lines} in ${Math.round((Date.now() - t0) / 1000)} s`)
check(await ev(`${S}.rows.every(r => r.concept === '')`), 'nothing is tagged until the user accepts (AI only proposes)')
const share = await ev(`${S}.rows.find(r => /share capital/i.test(r.label))?.suggestions.map(s => s.qname)`)
console.log('  Share capital →', JSON.stringify(share))
await ev(`${S}.acceptTop()`)
check(await ev(`${S}.rows.filter(r => r.concept).length`) === withSuggestions, 'Accept top suggestions tags every suggested line')
await sleep(500)
await shot('03-tagging.png')

// 3. Company & auditor (synthetic values, not the client's)
await ev(`${S}.setStep('masters')`)
await waitFor(`${S}.fields !== null`, 'master fields', 60000)
const fields = await ev(`${S}.fields.company.map(f => [f.qname, f.type])`)
check(fields.length > 5, 'mandatory company fields come from the knowledge base', `${fields.length} fields`)
const synthetic = {
  NameOfCompany: 'Synthetic Test Private Limited', CorporateIdentityNumber: 'U72200KA2010PTC123456', PermanentAccountNumberOfEntity: 'AAACS1234A',
  AddressOfRegisteredOfficeOfCompany: '1 Test Street, Bengaluru', TypeOfIndustry: 'Commercial and Industrial', DateOfBoardMeetingWhenFinalAccountsWereApproved: '2026-05-20',
  ContentOfReport: 'Financial Statements', DescriptionOfPresentationCurrency: 'INR', LevelOfRoundingUsedInFinancialStatements: 'Actual',
  WhetherCompanyIsMaintainingBooksOfAccountAndOtherRelevantBooksAndPapersInElectronicForm: 'true',
}
for (const [q] of fields) { const local = q.split(':')[1]; if (synthetic[local]) await ev(`${S}.setCompany(${JSON.stringify(q)}, ${JSON.stringify(synthetic[local])})`) }
const auditor = await ev(`${S}.fields.auditor.map(f => [f.qname, f.type])`)
for (const [q, type] of auditor) await ev(`${S}.setAuditor(${JSON.stringify(q)}, ${JSON.stringify(/boolean/i.test(type) ? 'false' : 'Unmodified opinion.')})`)
await ev(`${S}.updateSignatory(0, { din: '01234567', name: 'Asha Test', designation: 'Director' })`)
await ev(`${S}.updateSignatory(1, { din: '07654321', name: 'Ravi Test', designation: 'Director' })`)
check(await ev(`(${S}.company['in-ca:DateOfEndOfReportingPeriod'] ?? '') === ${S}.meta.endDate`), 'period fields prefilled from the filing settings')
await sleep(500)
await shot('04-masters.png')

// 4. Generate
await ev(`${S}.setStep('generate')`)
await sleep(500)
await shot('05-generate-before.png')
await click('indas-generate')
await waitFor(`${S}.result !== null`, 'generate', 180000)
const result = await ev(`${S}.result`)
if (result.ok) check(true, 'XML generated into the projects folder', result.path)
else console.log('  MCA problems:', result.errors.length, JSON.stringify(result.errors.slice(0, 6), null, 1))
check(result.ok || result.errors.length > 0, 'Generate answers with the XML or the MCA problems')
await sleep(500)
await shot('06-generate-result.png')

check(errors.length === 0, 'no uncaught renderer errors', errors.join(' | '))
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PASSED')
ws.close()
process.exit(failures.length ? 1 : 0)
