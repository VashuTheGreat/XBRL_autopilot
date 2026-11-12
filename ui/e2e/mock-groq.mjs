// A scripted stand-in for Groq's chat completions API (OpenAI-compatible), for the Phase 10 E2E: the sidecar is
// launched with GROQ_URL=http://127.0.0.1:<port>/openai/v1/chat/completions, so no request ever leaves the machine.
//
// Behaviour, per fix-agent request (the bundle is the first user message):
//   1st call  → a tool call: get_source_row for the problem's cell, else get_concept for its element
//   2nd call  → the answer: when the problem is a missing current-year value and the problem cell's row has a number
//               in the current-year column, setValue from that cell; otherwise setValue with source "user"
// Every request body is kept, so the test can check what was sent (no CIN, no company name).
import { createServer } from 'node:http'

export function startMockGroq(port) {
  const requests = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const send = (status, data) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(data))
      }
      if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) return send(404, { error: 'not found' })
      let parsed
      try {
        parsed = JSON.parse(body)
      } catch {
        return send(400, { error: 'bad json' })
      }
      requests.push({ auth: req.headers.authorization ?? '', body: parsed })
      send(200, reply(parsed))
    })
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ requests, close: () => server.close() })))
}

function reply(req) {
  const msgs = req.messages ?? []
  let bundle = {}
  try {
    bundle = JSON.parse(msgs.find((m) => m.role === 'user')?.content ?? '{}')
  } catch {}
  const pr = bundle.problem ?? {}
  const usage = { prompt_tokens: 900, completion_tokens: 80 }
  const toolsDone = msgs.some((m) => m.role === 'tool')
  if (!toolsDone && req.tools && req.tool_choice !== 'none') {
    const call = pr.cell
      ? { name: 'get_source_row', arguments: JSON.stringify({ sheet: pr.cell.sheet, ref: pr.cell.ref }) }
      : { name: 'get_concept', arguments: JSON.stringify({ qname: pr.concept ?? 'in-gaap:ShareCapital' }) }
    return { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: call }] } }], usage }
  }
  const row = (bundle.sources ?? []).find((s) => pr.cell && s.cell.sheet === pr.cell.sheet && s.cell.ref === pr.cell.ref)
  const cy = row?.neighbours?.find((n) => n.column === 'CY' && n.ref !== pr.cell?.ref && typeof n.value === 'number')
  let answer
  if (pr.concept && pr.scope === 'CY' && cy) {
    answer = {
      summary: `The current-year figure is in ${pr.cell.sheet}!${cy.ref}, next to the previous-year figure.`,
      patches: [{ op: 'setValue', fact: { concept: pr.concept, scope: 'CY' }, value: String(cy.value), source: { kind: 'cell', cell: { ...pr.cell, ref: cy.ref } }, rationale: `${cy.ref} is the current-year column of the same row.`, confidence: 0.92 }],
      resolves: [pr.id], needsHuman: false,
    }
  } else {
    answer = {
      summary: 'The amount is not in the data sent; it has to come from you.',
      patches: pr.concept ? [{ op: 'setValue', fact: { concept: pr.concept, scope: pr.scope === 'PY' ? 'PY' : 'CY' }, value: null, source: { kind: 'user' }, rationale: 'Not in the workbook.', confidence: 0.3 }] : [],
      resolves: [], needsHuman: true,
    }
  }
  return { choices: [{ message: { role: 'assistant', content: JSON.stringify(answer) } }], usage }
}
