/**
 * AI fix agent in the app (Phase 10, ADR-0012) on a real C&I filing (knowledge-base authority with the business rules)
 * and the synthetic sample workbook, with a scripted proposer in place of the sidecar: what the bundle carries (and
 * never carries), the engine / Excel checks of each patch, accept → applied + revalidated + audited, reject, the
 * explicit confirmation of removals and typed values, the Fix all stop conditions, the AI gates and the fixture guard.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AiPatch, AiView } from '@shared/ai'
import type { Problem } from '@shared/validation'
import type { CellRef } from '@shared/workbook'
import { AppDatabase } from '../electron/main/infra/app-database'
import { DirAutosaveStore } from '../electron/main/infra/dir-autosave-store'
import { readXlsx } from '../electron/main/infra/xlsx-reader'
import { AiHistory } from '../electron/main/services/ai-history'
import { ColumnPeriodService } from '../electron/main/services/column-period-service'
import { ContextBundleBuilder, labelMatches } from '../electron/main/services/context-bundle-builder'
import { ValidationError } from '../electron/main/services/errors'
import { FixAgentService, type FixAgentBudget } from '../electron/main/services/fix-agent-service'
import { fixtureDigest, HashFixtureGuard } from '../electron/main/services/fixture-guard'
import { MappingService } from '../electron/main/services/mapping-service'
import { PatchApplier } from '../electron/main/services/patch-applier'
import { PatchVerifier } from '../electron/main/services/patch-verifier'
import type { FixBundle, FixProposal, FixProposer, MappingMemoryRepository } from '../electron/main/services/ports'
import { ProjectService } from '../electron/main/services/project-service'
import { SourceService } from '../electron/main/services/source-service'
import { ValidationService } from '../electron/main/services/validation-service'
import { kbAuthorityService, kbReady } from './helpers/kb-authorities'

const SAMPLE = resolve(__dirname, '../../data/sample_financials.xlsx')
const CIN = 'U72200KA2010PLC123456'
const SC = 'in-gaap:ShareCapital'
const cell = (ref: string): CellRef => ({ workbook: 'workbook-1.xlsx', sheet: 'BS', ref })

class ScriptedProposer implements FixProposer {
  bundles: FixBundle[] = []
  constructor(private readonly answer: (b: FixBundle) => Partial<FixProposal> | Error) {}
  async propose(b: FixBundle): Promise<FixProposal> {
    this.bundles.push(b)
    const a = this.answer(b)
    if (a instanceof Error) throw a
    return { summary: 'ok', patches: [], dropped: [], resolves: [], needsHuman: false, steps: 2, usage: { promptTokens: 300, completionTokens: 50, totalTokens: 350 }, toolCalls: [], stop: 'answered', model: 'fake', ...a }
  }
}

describe.skipIf(!kbReady)('FixAgentService', () => {
  let projects: ProjectService
  let sources: SourceService
  let columns: ColumnPeriodService
  let mapping: MappingService
  let validation: ValidationService
  let remembered: string[]
  let availability: { consent: boolean; sidecar: 'ready' | 'starting' | 'down'; keyConfigured: boolean; model: string | null }
  let guard: HashFixtureGuard
  let pushed: AiView[]

  const memory: MappingMemoryRepository = { recall: () => [], remember: (_t, label, concept) => void remembered.push(`${label}→${concept}`) }
  const agent = (proposer: FixProposer, budget: Partial<FixAgentBudget> = {}) =>
    new FixAgentService(
      projects,
      validation,
      new ContextBundleBuilder(sources, columns, () => mapping.list()),
      proposer,
      new PatchVerifier(mapping, columns, () => '2014-09-30'),
      new PatchApplier(mapping),
      new AiHistory({ now: () => new Date('2026-11-11T10:00:00Z') }, () => 'tester'),
      { state: () => availability },
      guard,
      (v) => pushed.push(v),
      { budget },
    )
  const pairing = (): Problem => validation.run().problems.find((p) => p.ruleId === 'GR-6' && p.cell?.ref === 'D9')!
  const history = () => projects.project().content.aiHistory.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>)
  /** the bundle's opaque id of the problem's own fact */
  const ownAlias = (b: FixBundle) => b.problem.factKey!
  const cyFromC9: AiPatch = { op: 'setValue', fact: { concept: SC, scope: 'CY' }, value: '60000000', source: { kind: 'cell', cell: cell('C9') }, rationale: 'C9 is the CY column', confidence: 0.9 }

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xap-ai-'))
    projects = new ProjectService({ authority: kbAuthorityService(), recents: new AppDatabase(':memory:'), autosave: new DirAutosaveStore(join(dir, 'a')), appVersion: '0.1.0' })
    sources = new SourceService(projects, readXlsx)
    columns = new ColumnPeriodService(projects, sources)
    remembered = []
    mapping = new MappingService(projects, sources, columns, memory)
    validation = new ValidationService(projects, () => mapping.list(), () => {}, { delayMs: 10_000, today: () => '2014-09-30' })
    availability = { consent: true, sidecar: 'ready', keyConfigured: true, model: 'fake' }
    guard = new HashFixtureGuard([])
    pushed = []
    await projects.newFiling({
      companyName: 'XBRL Ltd', cin: CIN, reportType: 'Standalone',
      cy: { start: '2013-04-01', end: '2014-03-31' }, py: { start: '2012-04-01', end: '2013-03-31' }, level: 'Actual',
    })
    await sources.importWorkbook('sample_financials.xlsx', readFileSync(SAMPLE))
    await mapping.tag({ cell: cell('D9'), concept: SC, scope: 'PY' }) // previous year only → CY/PY pairing (GR-6) fails
  })

  it('is off without consent, key or sidecar, and for repository client data; quick fixes do not depend on it', () => {
    const svc = agent(new ScriptedProposer(() => ({})))
    expect(svc.status()).toMatchObject({ enabled: true, model: 'fake' })
    availability.consent = false
    expect(svc.status().reason).toBe('no-consent')
    availability.consent = true
    availability.keyConfigured = false
    expect(svc.status().reason).toBe('no-key')
    availability.keyConfigured = true
    availability.sidecar = 'starting'
    expect(svc.status()).toMatchObject({ reason: 'sidecar', message: 'The AI engine is starting…' })
    availability.sidecar = 'ready'
    availability.consent = false
    expect(pairing().fix).not.toBeNull() // the deterministic Fix button stays
    return expect(svc.ask(pairing().id)).rejects.toThrow(ValidationError)
  })

  it('refuses a project whose workbook is a repository fixture (by content and by file name)', async () => {
    guard = new HashFixtureGuard([{ name: 'Client.xlsx', digest: fixtureDigest('x.xlsx', new Uint8Array(readFileSync(SAMPLE))) }])
    const svc = agent(new ScriptedProposer(() => ({})))
    expect(svc.status()).toMatchObject({ enabled: false, reason: 'fixture' })
    expect(svc.status().message).toContain('Client.xlsx')
    await expect(svc.ask(pairing().id)).rejects.toThrow(/never sent to an AI service/)
    guard = new HashFixtureGuard([{ name: 'sample_financials.xlsx', digest: 'other' }])
    expect(agent(new ScriptedProposer(() => ({}))).status().reason).toBe('fixture')
    expect(new HashFixtureGuard([]).match(projects.project().content)).toBeNull() // packaged app: no data/, no-op
  })

  it('sends the problem with its facts and Excel rows, but no identity data and no fact keys', async () => {
    const proposer = new ScriptedProposer(() => ({}))
    await agent(proposer).ask(pairing().id)
    const b = proposer.bundles[0]!
    const text = JSON.stringify(b)
    expect(text).not.toContain(CIN)
    expect(text).not.toContain('XBRL Ltd')
    expect(text).not.toContain('#') // fact keys (which can hold typed members) stay on this machine
    expect(b.facts.some((f) => /CorporateIdentityNumber|NameOfCompany/.test(f.concept))).toBe(false)
    expect(b.problem).toMatchObject({ id: 'p1', ruleId: 'GR-6', concept: SC, scope: 'CY', cell: cell('D9') }) // the missing year
    expect(b.problem.rule?.text).toBeTruthy()
    expect(b.facts.find((f) => f.key === ownAlias(b))).toMatchObject({ concept: SC, scope: 'PY', value: '30000000', cell: cell('D9') })
    const row = b.sources.find((s) => s.cell.ref === 'D9')!
    expect(row.label).toBe('- Share Capital')
    expect(row.neighbours).toEqual(expect.arrayContaining([{ ref: 'C9', value: 60000000, column: 'CY' }, { ref: 'D9', value: 30000000, column: 'PY' }]))
    expect(b.meta).toMatchObject({ cyEnd: '2014-03-31', level: 'Actual' })
    // and exactly that payload is in the audit trail
    expect(history().find((h) => h.type === 'request')!.payload).toEqual(JSON.parse(text))
  })

  it('for an element with no tagged cell, sends the workbook rows labelled like it', async () => {
    const proposer = new ScriptedProposer(() => ({}))
    const problem = validation.run().problems.find((p) => p.location?.concept === 'in-gaap:ReservesAndSurplus' && p.location.scope === 'CY' && !p.cell)!
    await agent(proposer).ask(problem.id)
    const row = proposer.bundles[0]!.sources.find((s) => s.label === '- Reserves & Surplus')!
    expect(row.cell.ref).toBe('C10') // the current-year cell, not the "Note No." column (B10 = 2)
    expect(row.neighbours).toEqual(expect.arrayContaining([{ ref: 'C10', value: -343854, column: 'CY' }]))
    expect(labelMatches('Total Reserves and Surplus (net)', 'Reserves and surplus')).toBe(true)
    expect(labelMatches('Share capital', 'Reserves and surplus')).toBe(false)
  })

  it('leaves out other text blocks and cuts the problem’s own text to 200 characters', async () => {
    const p = projects.project()
    const A = p.authority.authority as unknown as { concepts: Record<string, unknown>; dataType(q: string): string; isReportable(q: string): boolean; conceptElrs(q: string): string[] }
    const filing = p.session.filing as unknown as { setFact(f: Record<string, unknown>): { key: string } }
    const blocks = Object.keys(A.concepts).filter((q) => A.dataType(q) === 'textBlock' && A.isReportable(q))
    const elrUri = A.conceptElrs(blocks[0]!).find((u: string) => blocks.filter((q) => A.conceptElrs(q).includes(u)).length > 1)!
    const [t1, t2] = blocks.filter((q) => A.conceptElrs(q).includes(elrUri))
    const period = { type: 'duration', start: '2013-04-01', end: '2014-03-31' }
    const f1 = filing.setFact({ concept: t1!, period, value: `<p>${'Policy text. '.repeat(40)}</p>` })
    filing.setFact({ concept: t2!, period, value: '<p>Signed by the directors</p>' })
    const problem: Problem = {
      id: 'engine:x', severity: 'error', source: 'engine', family: 'fact', code: 'html', ruleId: null, message: 'bad HTML', cell: null, fix: null,
      location: { kind: 'concept', elrUri, elrCode: null, elrTitle: null, tableId: null, concept: t1!, scope: 'CY', factKey: f1.key },
    }
    const { bundle } = await new ContextBundleBuilder(sources, columns, () => mapping.list()).build(p, problem)
    expect(bundle.facts.map((f) => f.concept)).toContain(t1)
    expect(bundle.facts.map((f) => f.concept)).not.toContain(t2)
    expect(bundle.facts.find((f) => f.concept === t1)!.value!.length).toBe(200)
  })

  it('shows a checked patch, applies it on Accept through the mapping (origin ai) and revalidates', async () => {
    const svc = agent(new ScriptedProposer(() => ({ patches: [cyFromC9] })))
    const problem = pairing()
    const v = await svc.ask(problem.id)
    const card = v.proposals[0]!.cards[0]!
    expect(card).toMatchObject({ status: 'proposed', title: 'Set Share capital (current year)', sourceLabel: 'Excel BS!C9', before: null, after: '60000000', resolves: true, needsConfirm: false, needsInput: false })
    expect(v.run).toMatchObject({ mode: 'single', state: 'reviewing' })
    const after = await svc.accept(card.id)
    expect(after.proposals[0]!.cards[0]!.status).toBe('accepted')
    expect(after.run.state).toBe('done')
    const c9 = mapping.approvedAt(cell('C9'))!
    expect(c9).toMatchObject({ origin: 'ai', confidence: 0.9, fact: { concept: SC, scope: 'CY' }, value: '60000000' })
    expect(remembered).toContain('- Share Capital→in-gaap:ShareCapital')
    expect(validation.view().problems.some((p) => p.id === problem.id)).toBe(false)
    expect(history().map((h) => [h.type, h.by])).toEqual([['request', 'tester'], ['response', 'tester'], ['accept', 'tester']])
  })

  it('drops what the engine or Excel contradicts, and needs input + confirmation for a value the user must supply', async () => {
    const svc = agent(new ScriptedProposer((b) => ({
      patches: [
        { ...cyFromC9, value: '6000000' }, // the cell shows 60000000
        { op: 'removeFact', fact: { key: 'f999', concept: SC, scope: 'PY' } }, // a removal must name a fact the app sent
        { op: 'setValue', fact: { key: ownAlias(b), concept: SC, scope: 'PY' }, value: '31000000', source: { kind: 'user' } }, // over an Excel value
        { op: 'setValue', fact: { concept: SC, scope: 'CY' }, value: null, source: { kind: 'user' }, rationale: 'not in the workbook' },
      ],
    })))
    const v = await svc.ask(pairing().id)
    const reasons = v.proposals[0]!.dropped.map((d) => d.reason)
    expect(reasons).toEqual([
      'excel: BS!C9 shows 60000000, not 6000000.',
      'sidecar: names a fact the app did not send',
      'excel: this value comes from Excel BS!D9; change the cell or re-tag it instead of typing over it.',
    ])
    const card = v.proposals[0]!.cards[0]!
    expect(card).toMatchObject({ needsInput: true, needsConfirm: true, sourceLabel: 'you type it', resolves: null })
    await expect(svc.accept(card.id)).rejects.toThrow('Type the value first.')
    await expect(svc.accept(card.id, { input: '60000000' })).rejects.toThrow('Confirm this change first.')
    await svc.accept(card.id, { input: '60000000', confirmed: true })
    expect((projects.project().session.getValue(SC, 'CY') as { value: string }).value).toBe('60000000')
    expect(history().at(-1)).toMatchObject({ type: 'accept', input: '60000000' })
  })

  it('records a rejected re-tag without touching the filing or teaching the memory', async () => {
    const svc = agent(new ScriptedProposer(() => ({ patches: [{ op: 'remap', cell: cell('D9'), from: SC, to: 'in-gaap:ReservesAndSurplus', confidence: 0.4 }] })))
    const card = (await svc.ask(pairing().id)).proposals[0]!.cards[0]!
    expect(card).toMatchObject({ title: 'Re-tag BS!D9 as Reserves and surplus', before: 'Share capital', after: 'Reserves and surplus' })
    remembered = []
    const v = svc.reject(card.id, 'D9 is share capital')
    expect(v.proposals[0]!.cards[0]).toMatchObject({ status: 'rejected', note: 'D9 is share capital' })
    expect(mapping.approvedAt(cell('D9'))!.fact.concept).toBe(SC)
    expect(remembered).toEqual([])
    expect(history().at(-1)).toMatchObject({ type: 'reject', reason: 'D9 is share capital', cardId: card.id })
  })

  it('removes a fact only after an explicit confirmation, and with it its Excel tag', async () => {
    const svc = agent(new ScriptedProposer((b) => ({ patches: [{ op: 'removeFact', fact: { key: ownAlias(b), concept: SC, scope: 'PY' } }] })))
    const card = (await svc.ask(pairing().id)).proposals[0]!.cards[0]!
    expect(card).toMatchObject({ needsConfirm: true, before: '30000000', after: null, resolves: true })
    await expect(svc.accept(card.id)).rejects.toThrow('Confirm')
    await svc.accept(card.id, { confirmed: true })
    expect(mapping.approvedAt(cell('D9'))).toBeNull()
    expect(projects.project().session.getValue(SC, 'PY')).toBeNull()
  })

  it('Fix all: at most perRound problems a round, errors first, and stops when nothing is accepted', async () => {
    const proposer = new ScriptedProposer(() => ({ patches: [cyFromC9] })) // a valid card for every problem
    const svc = agent(proposer, { perRound: 3 })
    svc.fixAll()
    await svc.idle()
    expect(validation.view().summary.errors).toBeGreaterThan(3)
    expect(proposer.bundles.length).toBe(3)
    expect(proposer.bundles.every((b) => b.problem.severity === 'error')).toBe(true)
    const v = svc.view()
    expect(v.run).toMatchObject({ mode: 'fix-all', state: 'reviewing', round: 1, perRound: 3, maxRounds: 5 })
    expect(v.proposals.flatMap((p) => p.cards)).toHaveLength(3)
    for (const c of v.proposals.flatMap((p) => p.cards)) svc.reject(c.id)
    expect(svc.view().run).toMatchObject({ state: 'done', stopReason: 'nothing-accepted' })
    expect(history().at(-1)).toMatchObject({ type: 'run', stopReason: 'nothing-accepted', rounds: 1 })
  })

  it('Fix all: the GR-6 patch accepted, the next round starts; round limit, token budget and errors stop it', async () => {
    const gr6First = (b: FixBundle) => ({ patches: b.problem.ruleId === 'GR-6' && b.problem.cell?.ref === 'D9' ? [cyFromC9] : [] })
    // round limit: one round, its patch accepted, errors remain → max-rounds
    const target = pairing().id
    const svc = agent(new ScriptedProposer(gr6First), { maxRounds: 1, perRound: 1000 })
    svc.fixAll()
    await svc.idle()
    const card = svc.view().proposals.flatMap((p) => p.cards).find((c) => c.title.startsWith('Set Share capital'))!
    expect(card).toBeTruthy()
    for (const c of svc.view().proposals.flatMap((p) => p.cards)) if (c.id !== card.id) svc.reject(c.id)
    await svc.accept(card.id)
    expect(svc.view().run).toMatchObject({ state: 'done', stopReason: 'max-rounds', round: 1 })
    expect(validation.view().problems.some((p) => p.id === target)).toBe(false)

    // token budget: 350 tokens per answer, budget 700 → two requests, then stop
    const counting = new ScriptedProposer(() => ({}))
    const svc2 = agent(counting, { tokenBudget: 700, perRound: 50 })
    svc2.fixAll()
    await svc2.idle()
    expect(counting.bundles.length).toBe(2)
    expect(svc2.view().run).toMatchObject({ state: 'done', stopReason: 'budget-tokens', tokens: 700 })

    // the AI service fails → the run stops with the reason; the error is in the audit trail
    const failing = agent(new ScriptedProposer(() => new Error('The AI service failed: LLM request failed (HTTP 503)')))
    failing.fixAll()
    await failing.idle()
    expect(failing.view().run).toMatchObject({ state: 'done', stopReason: 'error' })
    expect(failing.view().proposals[0]!.error).toMatch(/HTTP 503/)
    expect(history().some((h) => h.type === 'error')).toBe(true)
  })
})
