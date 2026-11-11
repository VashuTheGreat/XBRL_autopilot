// Phase 10 live smoke test: the AI fix agent against the REAL Groq model (dev key from .env), on synthetic data only
// (C&I filing + data/sample_financials.xlsx; never a client fixture: the fixture guard would refuse it anyway).
// A real model is not deterministic, so this prints what it proposed and checks only the contract: an answer arrives,
// every shown patch passed the engine's checks, nothing identifying was sent. Run the app WITHOUT GROQ_URL.
// Usage: node e2e/phase10-live-groq.mjs <cdpPort> <screenshotDir> <sample_financials.xlsx> [problems=3]
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [port, outDir, sample, howMany = '3'] = process.argv.slice(2)
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
const waitFor = async (expr, label, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(500) } throw new Error('timeout: ' + label) }
const T = 'window.__xap_test__'
const aiView = `${T}.ai.getState().view`
const failures = []
const check = (ok, what, detail = '') => { console.log(ok ? 'PASS' : 'FAIL', what, detail ? '— ' + detail : ''); if (!ok) failures.push(what) }

await send('Runtime.enable')
await waitFor(`!!${T}?.ai && document.body.innerText.includes('Recent filings')`, 'app ready', 120000)
await ev(`window.xap.project.create({ companyName: 'XBRL Ltd', cin: 'U72200KA2010PLC123456', reportType: 'Standalone', cy: { start: '2013-04-01', end: '2014-03-31' }, py: { start: '2012-04-01', end: '2013-03-31' }, level: 'Actual' })`)
await ev(`${T}.project.getState().init()`)
await waitFor(`!!${T}.project.getState().summary`, 'summary')
await ev(`${T}.editor.getState().importWorkbook(${JSON.stringify(sample)})`)
await waitFor(`${T}.editor.getState().workbooks.length > 0`, 'workbook', 120000)
await ev(`window.xap.settings.update({ aiConsent: true })`)
await waitFor(`${aiView}?.status.enabled === true`, 'AI enabled (needs GROQ_API_KEY in .env)', 120000)
console.log('model:', await ev(`${aiView}.status.model`))
const sheet = await ev(`${T}.editor.getState().workbooks[0].sheets[0].name`)
await ev(`window.xap.editor.tag({ cell: { workbook: 'workbook-1.xlsx', sheet: ${JSON.stringify(sheet)}, ref: 'D9' }, concept: 'in-gaap:ShareCapital', scope: 'PY' })`)
await waitFor(`${T}.validation.getState().view.problems.some(p => p.ruleId === 'GR-6' && p.cell?.ref === 'D9')`, 'GR-6 on D9', 30000)

// the D9 pairing problem first, then a few other errors without a cell
const ids = await ev(`(() => { const ps = ${T}.validation.getState().view.problems; const first = ps.find(p => p.ruleId === 'GR-6' && p.cell?.ref === 'D9'); return [first.id, ...ps.filter(p => p.severity === 'error' && p.id !== first.id && p.family === 'rule' && p.location?.concept).slice(0, ${Number(howMany) - 1}).map(p => p.id)] })()`)
for (const pid of ids) {
  const t0 = Date.now()
  await ev(`${T}.ai.getState().ask(${T}.validation.getState().view.problems.find(p => p.id === ${JSON.stringify(pid)}))`)
  await waitFor(`${aiView}.run.state !== 'proposing'`, 'answer', 400000)
  const p = await ev(`${aiView}.proposals.at(-1)`)
  console.log(`\n── ${p.problemMessage.slice(0, 140)}`)
  console.log(`   ${((Date.now() - t0) / 1000).toFixed(1)} s · ${p.steps} step(s) · ${p.tokens} tokens · needsHuman=${p.needsHuman}`)
  if (p.error) console.log('   ERROR:', p.error)
  console.log('   summary:', p.summary)
  for (const c of p.cards) console.log(`   card: ${c.title} | ${c.before ?? '(empty)'} → ${c.after ?? '(you type it)'} | ${c.sourceLabel ?? ''} | resolves=${c.resolves} | ${c.rationale.slice(0, 120)}`)
  for (const d of p.dropped) console.log(`   dropped: ${d.reason}`)
  check(!p.error, 'the real model answered', p.error ?? `${p.cards.length} card(s), ${p.dropped.length} dropped`)
}
const s = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(join(outDir, 'p10-live.png'), Buffer.from(s.result.data, 'base64'))
const sent = JSON.stringify(await ev(`window.xap.ai.history().then(r => r.value.filter(e => e.type === 'request').map(e => e.payload))`))
check(!sent.includes('U72200KA2010PLC123456') && !sent.includes('XBRL Ltd'), 'no CIN or company name in what was sent')
check(errors.length === 0, 'no renderer errors', errors.slice(0, 3).join(' | '))
ws.close()
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed')
process.exit(failures.length ? 1 : 0)
