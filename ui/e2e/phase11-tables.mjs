// Phase 11 table tagging (ADR-0013), dev app, Ind AS filing + the DGPL workbook (.xls); no AI.
// Map as table: the PPE schedule (sheet FA) → [400600] PPE table through the dialog (real selects, Preview, Map) →
// the Form shows the table with source chips; Excel → Form opens the note on the cell's row; Form → Excel reveals the
// cell; Also report as (dialog): Equity share capital also as class "Equity shares 1"; Table zeros → 0 clears the
// mandatory-line-items problems; removing the block untags its cells.
// Usage: node e2e/phase11-tables.mjs <port> <screenshotDir> "<path>/data/BS DGPL Mar-2026-V1.xls"
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
const [port, outDir, dgpl] = process.argv.slice(2)
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
const shot = (name) => send('Page.captureScreenshot', { format: 'png' }).then((s) => writeFileSync(join(outDir, name), Buffer.from(s.result.data, 'base64')))
const T = 'window.__xap_test__'
const failures = []
const check = (ok, what, detail = '') => { console.log(ok ? 'PASS' : 'FAIL', what, detail ? '— ' + detail : ''); if (!ok) failures.push(what) }

// a React-controlled <select>: set its value through the native setter, then the change event React listens to
const pickJs = `(sel, value) => { const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!el) return 'missing ' + sel; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(el, value); el.dispatchEvent(new Event('change', { bubbles: true })); return el.value === value || [...el.options].some((o) => o.value === value) }`
const pick = (sel, value) => ev(`(${pickJs})(${JSON.stringify(sel)}, ${JSON.stringify(value)})`)
const click = (sel) => ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b || b.disabled) return false; b.click(); return true })()`)

const P = 'ind-as:'
const PPE_TABLE = '400600:DisclosureOfPropertyPlantAndEquipmentTable'
const CARRYING = `${P}CarryingAmountAccumulatedDepreciationAndGrossCarryingAmountAxis`
const CLASSES = `${P}ClassesOfPropertyPlantAndEquipmentAxis`
const GROSS = `${CARRYING}||${P}GrossCarryingAmountMember`
const ACC = `${CARRYING}||${P}AccumulatedDepreciationAndImpairmentMember`
const PPE = `${P}PropertyPlantAndEquipment`
const ADD = `${P}AdditionsOtherThanThroughBusinessCombinationsPropertyPlantAndEquipment`
// DGPL sheet FA (0-based rows): gross block 10–17, accumulated depreciation 21–28; classes in columns C–F
const ROWS = [
  [10, `${PPE}|periodStartLabel`, 'PY', GROSS], [11, `${ADD}|`, 'PY', GROSS], [13, `${PPE}|periodEndLabel`, 'PY', GROSS],
  [15, `${ADD}|`, 'CY', GROSS], [17, `${PPE}|periodEndLabel`, 'CY', GROSS],
  [21, `${PPE}|periodStartLabel`, 'PY', ACC], [24, `${PPE}|periodEndLabel`, 'PY', ACC],
  [26, `${P}DepreciationPropertyPlantAndEquipment|negatedTotalLabel`, 'CY', ACC], [28, `${PPE}|periodEndLabel`, 'CY', ACC],
]
const COLS = [[2, 'OtherPlantAndEquipmentMember'], [3, 'FurnitureAndFixturesMember'], [4, 'ComputerEquipmentsMember'], [5, 'OfficeEquipmentMember']]

await send('Runtime.enable')
await send('Page.enable')
await waitFor(`!!${T}?.editor && !!${T}?.tables && document.body.innerText.includes('Recent filings')`, 'app ready', 120000)
await ev(`window.xap.project.create({ taxonomy: 'ind-as-2017', companyName: 'Synthetic Pvt Ltd', cin: 'U72200KA2010PTC123456', reportType: 'Standalone', cy: { start: '2025-04-01', end: '2026-03-31' }, py: { start: '2024-04-01', end: '2025-03-31' }, level: 'Lakhs', statementPlaces: 2 })`)
await ev(`${T}.project.getState().init()`)
await waitFor(`${T}.project.getState().elrs.length > 50`, 'Ind AS statements', 60000)
await ev(`${T}.editor.getState().importWorkbook(${JSON.stringify(dgpl)})`)
await waitFor(`${T}.editor.getState().workbooks.length > 0`, 'workbook', 120000)
const SRC = await ev(`${T}.editor.getState().workbooks[0].source`)
const FA = (ref) => `{ workbook: '${SRC}', sheet: 'FA', ref: '${ref}' }`

// 1. Map as table: disabled until a block is dragged; then the dialog
check(!(await click('[data-testid=map-as-table]')), '“Map as table” is disabled without a dragged block')
await ev(`${T}.editor.getState().setBlockRange(${FA('B10:F29')}), true`)
await waitFor(`!document.querySelector('[data-testid=map-as-table]').disabled`, 'button enabled')
await click('[data-testid=map-as-table]')
await waitFor(`!!document.querySelector('[data-testid=table-map-dialog]')`, 'dialog')
await waitFor(`document.querySelector('[data-testid=table-picker]')?.options.length > 100`, 'table catalog')
await pick('[data-testid=table-picker]', PPE_TABLE)
await waitFor(`document.querySelectorAll('[data-testid=table-map-row]').length >= 9`, 'block rows', 15000)
for (const [r, key, scope, member] of ROWS) {
  const row = `[data-testid=table-map-row][data-row="${r}"]`
  check(await pick(`${row} select[aria-label="Line item of row ${r + 1}"]`, key), `row ${r + 1}: line item`)
  await pick(`${row} select[aria-label="Year of row ${r + 1}"]`, scope)
  await pick(`${row} select[aria-label="Add a member"]`, member)
}
for (const [c, member] of COLS) await pick(`[data-testid=table-map-col][data-col="${c}"] select[aria-label="Add a member"]`, `${CLASSES}||${P}${member}`)
await click('[data-testid=table-preview]')
await waitFor(`/cells ready/.test(document.querySelector('[data-testid=table-map-dialog]')?.closest('[role=dialog]')?.innerText ?? '')`, 'preview', 15000)
const previewText = await ev(`document.querySelector('[role=dialog] footer').innerText`)
const ready = Number(/(\d+) cells ready/.exec(previewText)?.[1] ?? 0)
check(ready >= 30, 'Preview: the planned cells are ready', previewText)
await shot('phase11-map-dialog.png')
await click('[data-testid=table-apply]')
await waitFor(`!document.querySelector('[data-testid=table-map-dialog]')`, 'dialog closed', 20000)
await waitFor(`${T}.editor.getState().mappings.filter((m) => m.blockId).length >= 30`, 'block tags in store', 20000)
const blockTags = await ev(`${T}.editor.getState().mappings.filter((m) => m.blockId).length`)
check(blockTags === ready, 'every ready cell is tagged as one block', `${blockTags} tags`)
const e17 = await ev(`${T}.editor.getState().byCell.get('${SRC}|FA|E18')`)
check(e17?.fact?.tableId === PPE_TABLE && e17?.value === '0.73' && e17?.fact?.preferredLabel === 'periodEndLabel', 'FA!E18 → PPE closing (computers, gross, CY) = 0.73', JSON.stringify({ v: e17?.value, f: e17?.fact }))

// 2. Excel → Form: selecting a block cell opens the PPE note on that cell's value
const note = await ev(`${T}.project.getState().elrs.find((e) => e.code === '400600').uri`)
await ev(`${T}.editor.getState().setActiveElr(${T}.project.getState().elrs.find((e) => e.group === 'Statements').uri)`)
await ev(`${T}.editor.getState().selectCell(${FA('E18')}), true`)
await waitFor(`${T}.editor.getState().activeElr === ${JSON.stringify(note)}`, 'Form follows to [400600]', 15000)
await waitFor(`!!document.querySelector('[data-testid=form-table-grid][data-table="${PPE_TABLE}"]')`, 'table grid')
const fk = e17.factKey
await waitFor(`!!document.querySelector('[data-fact="${fk}"]')`, 'cell rendered')
check(await ev(`document.querySelector('[data-fact="${fk}"] [data-testid=source-chip]')?.innerText.trim() === 'E18'`), 'the Form shows the table cell with its source chip E18')
check(await ev(`document.querySelector('[data-fact="${fk}"] button').className.includes('outline-accent')`), 'the selected cell’s value is highlighted in the table')
const chips = await ev(`document.querySelectorAll('[data-testid=form-table-grid][data-table="${PPE_TABLE}"] [data-testid=source-chip]').length`)
check(chips >= 30, 'every mapped table value shows its source cell', `${chips} chips`)
await shot('phase11-form-table.png')

// 3. Form → Excel: clicking a table value selects and reveals its cell
await ev(`${T}.editor.getState().selectCell(${FA('A1')}), true`)
await ev(`document.querySelector('[data-fact="${fk}"] button').click(), true`)
check(await ev(`${T}.editor.getState().selection.cell?.ref === 'E18' && ${T}.editor.getState().reveal?.cell.ref === 'E18'`), 'clicking a table value selects and reveals FA!E18')

// 4. Also report as: Equity share capital (IND AS BS I39) also as class “Equity shares 1”
const BS = await ev(`${T}.editor.getState().workbooks[0].sheets.find((s) => s.name.trim() === 'IND AS BS').name`)
const bsCell = `{ workbook: '${SRC}', sheet: ${JSON.stringify(BS)}, ref: 'I39' }`
check(await ev(`window.xap.editor.tag({ cell: ${bsCell}, concept: '${P}EquityShareCapital', scope: 'CY' }).then((r) => r.ok)`), 'tag Equity share capital (I39)')
await waitFor(`!!${T}.editor.getState().byCell.get('${SRC}|${BS}|I39')`, 'tag in store')
await ev(`${T}.editor.getState().selectCell(${bsCell}), true`)
await waitFor(`!!document.querySelector('[data-testid=also-add]')`, 'inspector')
await click('[data-testid=also-add]')
await waitFor(`!!document.querySelector('[data-testid=also-dialog]') && document.querySelector('[data-testid=table-picker]')?.options.length > 100`, 'also dialog')
check(await ev(`document.querySelector('[data-testid=table-picker]').options[0].textContent.includes('★')`), 'tables reporting the element are offered first (★)')
await pick('[data-testid=table-picker]', '400100:DisclosureOfClassesOfEquityShareCapitalTable')
await waitFor(`document.querySelector('[data-testid=also-dialog] select[aria-label="Line item"]')?.value.startsWith('${P}EquityShareCapital|')`, 'own element preselected', 10000)
await pick('[data-testid=also-members] select[aria-label="Add a member"]', `${P}ClassesOfEquityShareCapitalAxis||${P}EquityShares1Member`)
await click('[data-testid=also-submit]')
await waitFor(`!document.querySelector('[data-testid=also-dialog]')`, 'also dialog closed', 10000)
await waitFor(`${T}.editor.getState().byCell.get('${SRC}|${BS}|I39')?.alsoViews?.length === 1`, 'also in store', 10000)
const sc = await ev(`${T}.editor.getState().byCell.get('${SRC}|${BS}|I39')`)
check(sc.alsoViews[0].value === sc.value && sc.factKeys.length === 2, 'the figure is also reported as the share class, same value', `${sc.value} / ${sc.alsoViews[0].value}`)
// the store updates first, React renders the inspector a frame later
check(await waitFor(`document.querySelector('[data-testid=also-reported]')?.innerText.includes('Equity shares 1')`, 'inspector chip', 5000).catch(() => false), 'the inspector shows “also: Equity shares 1”', await ev(`JSON.stringify({ sel: ${T}.editor.getState().selection.cell?.ref, insp: document.querySelector('[data-testid=inspector]')?.innerText.split(String.fromCharCode(10)).join(' | ') })`))
const scNote = await ev(`${T}.project.getState().elrs.find((e) => e.code === '400100').uri`)
await ev(`${T}.editor.getState().setActiveElr(${JSON.stringify(scNote)})`)
await waitFor(`!!document.querySelector('[data-fact="${sc.alsoViews[0].factKey}"] [data-testid=source-chip]')`, 'share class cell', 15000)
check(await ev(`document.querySelector('[data-fact="${sc.alsoViews[0].factKey}"] [data-testid=source-chip]').title.startsWith('Also reported from')`), 'the Form marks the share-class value “also reported from I39”')

// 5. Table zeros → 0 on the PPE note: the mandatory-line-items problems of the mapped columns go
await ev(`${T}.editor.getState().setActiveElr(${JSON.stringify(note)})`)
await waitFor(`!!document.querySelector('[data-testid=table-zeros]')`, 'zeros button')
const ml = `(${T}.validation.getState().view?.problems ?? []).filter((p) => p.ruleId === 'ML-13' && p.severity === 'error').length`
await ev(`${T}.validation.getState().run()`)
const before = await ev(ml)
await click('[data-testid=table-zeros]')
await waitFor(`document.body.innerText.includes('Reported as 0 in tables')`, 'zeros toast', 15000)
await ev(`${T}.validation.getState().run()`)
const after = await ev(ml)
check(before > 0 && after === 0, 'Table zeros → 0 clears the PPE mandatory-line-items errors', `${before} → ${after}`)

// 6. removing the block untags its cells and removes their facts
const blockId = await ev(`window.xap.editor.tableBlocks().then((r) => r.value[0].id)`)
await ev(`window.xap.editor.removeTable(${JSON.stringify(blockId)})`)
await waitFor(`${T}.editor.getState().mappings.filter((m) => m.blockId).length === 0`, 'block removed', 15000)
check(await ev(`!${T}.editor.getState().byCell.get('${SRC}|FA|E18')`), 'removing the block untags its cells')

check(errors.length === 0, 'no renderer errors', errors.slice(0, 3).join(' | '))
ws.close()
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed')
process.exit(failures.length ? 1 : 0)
