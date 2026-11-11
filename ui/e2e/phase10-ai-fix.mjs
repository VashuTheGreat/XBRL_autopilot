// Phase 10: the AI fix agent in the real (dev) app, against a scripted mock LLM — no request leaves the machine and no
// client data is used (C&I filing + the synthetic sample workbook).
// AI off without consent → consent + key → a PY-only share capital tag gives a CY/PY problem on BS!D9 → Ask AI → diff
// card (from Excel BS!C9, clears the problem) → Accept → problem gone, C9 tagged with origin ai → history shows the
// exact payload (no CIN, no company name) → a value the user must type needs input + confirmation; Reject is recorded →
// Fix all: round 1 of at most 10 problems, all rejected → stops "nothing accepted" → consent off: AI off, quick fixes stay.
//
// Launch the app with GROQ_URL pointing at the mock's port (see e2e/README.md), then:
// Usage: node e2e/phase10-ai-fix.mjs <cdpPort> <screenshotDir> <sample_financials.xlsx> <mockPort>
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { startMockGroq } from './mock-groq.mjs'

const [port, outDir, sample, mockPort = '8765'] = process.argv.slice(2)
const mock = await startMockGroq(Number(mockPort))
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
const CIN = 'U72200KA2010PLC123456'
const tab = (name) => ev(`[...document.querySelectorAll('[role=tab]')].find(b => b.textContent.startsWith(${JSON.stringify(name)})).click(), true`)
const aiView = `${T}.ai.getState().view`

await send('Runtime.enable')
await waitFor(`!!${T}?.ai && document.body.innerText.includes('Recent filings')`, 'app ready', 120000)

// 1. C&I filing + sample workbook; AI is off until the user consents
const created = await ev(`window.xap.project.create({ companyName: 'XBRL Ltd', cin: '${CIN}', reportType: 'Standalone', cy: { start: '2013-04-01', end: '2014-03-31' }, py: { start: '2012-04-01', end: '2013-03-31' }, level: 'Actual' }).then(r => r.ok || JSON.stringify(r.error))`)
check(created === true, 'C&I filing created', String(created))
await ev(`${T}.project.getState().init()`)
await waitFor(`!!${T}.project.getState().summary`, 'summary in store')
await ev(`window.xap.settings.update({ aiConsent: false })`)
await ev(`${T}.editor.getState().importWorkbook(${JSON.stringify(sample)})`)
await waitFor(`!!${T}?.univer && document.querySelector('[data-testid=univer-host] canvas')`, 'univer rendered', 120000)
await tab('AI Agent')
await waitFor(`document.querySelector('[data-testid=ai-off]')?.dataset.reason === 'no-consent'`, 'AI off banner', 15000)
check(true, 'AI is off without consent (banner says why)')

// 2. consent + a key (a dummy: requests go to the mock) → the sidecar restarts with AI on
await ev(`window.xap.settings.setGroqKey('gsk_mockKeyForTheE2eOnlyNotASecret0001')`)
await ev(`window.xap.settings.update({ aiConsent: true })`)
await waitFor(`${aiView}?.status.enabled === true`, 'AI enabled', 120000)
check(true, 'AI on after consent and a key', await ev(`${aiView}.status.model`))

// 3. PY-only share capital on D9 → the CY/PY pairing problem on that cell
const sheet = await ev(`${T}.editor.getState().workbooks[0].sheets[0].name`)
const tagged = await ev(`window.xap.editor.tag({ cell: { workbook: 'workbook-1.xlsx', sheet: ${JSON.stringify(sheet)}, ref: 'D9' }, concept: 'in-gaap:ShareCapital', scope: 'PY' }).then(r => r.ok || JSON.stringify(r.error))`)
check(tagged === true, 'D9 tagged as share capital (PY)', String(tagged))
await tab('Problems')
const gr6 = `[...document.querySelectorAll('[data-testid=problem]')].find(r => r.dataset.problemId.includes('rule.GR-6') && r.querySelector('[data-testid=problem-cell]')?.textContent.endsWith('!D9'))`
await waitFor(`!!${gr6}`, 'GR-6 problem on D9', 30000)
const problemId = await ev(`${gr6}.dataset.problemId`)

// 4. Ask AI → a diff card read from Excel C9 that clears the problem on a copy
await waitFor(`!${gr6}.querySelector('[data-testid=problem-ask-ai]').disabled`, 'Ask AI enabled', 10000)
await ev(`${gr6}.querySelector('[data-testid=problem-ask-ai]').click(), true`)
await waitFor(`document.querySelectorAll('[data-testid=ai-card]').length > 0`, 'AI card', 60000)
const cardText = await ev(`document.querySelector('[data-testid=ai-card]').innerText.replace(/\\n/g, ' ')`)
check(/Set Share capital \(current year\)/.test(cardText), 'Ask AI shows a diff card for the problem', cardText.slice(0, 160))
check(/from Excel .*!C9/.test(cardText), 'the amount names its source cell (C9)')
check(await ev(`!!document.querySelector('[data-testid=ai-resolves]')`), 'the engine dry run says it clears the problem')
check(mock.requests.length >= 2, 'the agent used a tool, then answered (mock LLM)', `${mock.requests.length} requests`)
const sent = JSON.stringify(mock.requests.map((r) => r.body))
check(!sent.includes(CIN) && !sent.includes('XBRL Ltd'), 'no CIN or company name reached the LLM')
check(mock.requests[0].auth === 'Bearer gsk_mockKeyForTheE2eOnlyNotASecret0001', 'the key from Settings was used (sidecar env, never the renderer)')
await shot('p10-01-card.png')

// 5. Accept → applied through the mapping (origin ai) and revalidated
await ev(`document.querySelector('[data-testid=ai-card] [data-testid=ai-accept]').click(), true`)
await waitFor(`document.querySelector('[data-testid=ai-card]')?.dataset.status === 'accepted'`, 'accepted', 30000)
await waitFor(`!${T}.validation.getState().view.problems.some(p => p.id === ${JSON.stringify(problemId)})`, 'problem gone', 15000)
check(true, 'Accept applies the patch and the problem is gone after revalidation')
const c9 = await ev(`window.xap.editor.mappings().then(r => r.value.find(m => m.cell.ref === 'C9'))`)
check(c9?.origin === 'ai' && c9?.fact?.scope === 'CY' && c9?.status === 'approved', 'C9 is tagged (CY) with origin ai', JSON.stringify(c9?.fact))

// 6. History: the exact payload, without identity data
await ev(`document.querySelector('[data-testid=ai-history-toggle]').click(), true`)
await waitFor(`document.querySelectorAll('[data-testid=ai-history-entry]').length >= 3`, 'history entries', 10000)
const types = await ev(`[...document.querySelectorAll('[data-testid=ai-history-entry]')].map(e => e.dataset.type)`)
check(['request', 'response', 'accept'].every((t) => types.includes(t)), 'history lists request, response and accept', types.join(','))
await ev(`[...document.querySelectorAll('[data-testid=ai-history-entry]')].find(e => e.dataset.type === 'request').querySelector('button').click(), true`)
const payload = await ev(`document.querySelector('[data-testid=ai-history-payload]')?.innerText ?? ''`)
check(payload.includes('"ruleId": "GR-6"') && !payload.includes(CIN), 'the logged payload is what was sent, without the CIN')
await shot('p10-02-history.png')
await ev(`document.querySelector('[data-testid=ai-history-toggle]').click(), true`)

// 7. A value the user must type: input + confirmation needed; Reject is recorded
const candidates = await ev(`${T}.validation.getState().view.problems.filter(p => p.severity === 'error' && !p.cell && p.location?.concept && p.location?.scope === 'CY' && p.family === 'rule').slice(0, 6).map(p => p.id)`)
let userCard = null
for (const pid of candidates) {
  await ev(`${T}.ai.getState().ask(${T}.validation.getState().view.problems.find(p => p.id === ${JSON.stringify(pid)}))`)
  await waitFor(`${aiView}.run.state !== 'proposing'`, 'proposal', 60000)
  userCard = await ev(`(${aiView}.proposals.at(-1).cards[0] ?? null)`)
  if (userCard) break
}
check(!!userCard && userCard.needsInput && userCard.needsConfirm, 'a value the user must supply needs input and confirmation', userCard?.title)
if (userCard) {
  const sel = `document.querySelector('[data-card-id=${JSON.stringify(userCard.id)}]')`
  check(await ev(`!!${sel}.querySelector('[data-testid=ai-input]') && ${sel}.querySelector('[data-testid=ai-accept]').disabled`), 'Accept stays disabled until a value is typed and confirmed')
  await ev(`${sel}.querySelector('[data-testid=ai-reject]').click(), true`)
  await waitFor(`${sel}?.dataset.status === 'rejected'`, 'rejected', 10000)
  const last = await ev(`window.xap.ai.history().then(r => r.value.at(-1))`)
  check(last?.type === 'reject' && last?.cardId === userCard.id, 'Reject is recorded in ai/history.jsonl')
}

// 8. Fix all: round 1 (≤ 10 problems); everything rejected → stops "nothing accepted"
const before = await ev(`${aiView}.proposals.length`)
await ev(`document.querySelector('[data-testid=ai-fix-all]').click(), true`)
await waitFor(`${aiView}.run.mode === 'fix-all' && ${aiView}.run.state !== 'proposing'`, 'round 1', 120000)
const round = await ev(`({ n: ${aiView}.proposals.length - ${before}, run: ${aiView}.run })`)
check(round.n > 0 && round.n <= 10, 'Fix all asks about at most 10 problems in a round', `${round.n} proposals, state ${round.run.state}`)
check(/round 1\/5/.test(await ev(`document.querySelector('[data-testid=ai-run]')?.innerText ?? ''`)), 'the round count is shown')
await shot('p10-03-fix-all.png')
for (let i = 0; i < 20; i++) {
  const open = await ev(`[...document.querySelectorAll('[data-testid=ai-card][data-status=proposed] [data-testid=ai-reject]')].length`)
  if (!open) break
  await ev(`document.querySelector('[data-testid=ai-card][data-status=proposed] [data-testid=ai-reject]').click(), true`)
  await sleep(200)
}
await waitFor(`${aiView}.run.state === 'done'`, 'run done', 30000)
const stopText = await ev(`document.querySelector('[data-testid=ai-run]')?.innerText ?? ''`)
check(['nothing-accepted', 'no-proposals'].includes(await ev(`${aiView}.run.stopReason`)) && /stopped:/.test(stopText), 'Fix all stops and shows why', stopText)

// 9. Consent withdrawn: AI off, deterministic quick fixes still offered
await ev(`window.xap.settings.update({ aiConsent: false })`)
await waitFor(`${aiView}.status.reason === 'no-consent'`, 'AI off again', 15000)
await tab('Problems')
check(await ev(`!!document.querySelector('[data-testid=problem-fix]') && [...document.querySelectorAll('[data-testid=problem-ask-ai]')].every(b => b.disabled)`), 'AI off: Ask AI disabled, quick fixes still there')

check(errors.length === 0, 'no renderer errors', errors.slice(0, 3).join(' | '))
ws.close()
mock.close()
if (failures.length) { console.log(`\n${failures.length} check(s) failed`); process.exit(1) }
console.log('\nall checks passed')
process.exit(0)
