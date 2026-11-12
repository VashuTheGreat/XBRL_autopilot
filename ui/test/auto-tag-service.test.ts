/**
 * AutoTagService + MappingService suggestions on the C&I sample workbook, against the real sidecar tagger
 * (POST /api/v1/mapping/suggest, LLM off): suggestions write no fact; accept / reject / accept-all; mapping memory.
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { CellRef } from '@shared/workbook'
import { AppDatabase } from '../electron/main/infra/app-database'
import { DirAutosaveStore } from '../electron/main/infra/dir-autosave-store'
import { FileAuthorityProvider } from '../electron/main/infra/file-authority-provider'
import { SidecarMappingSuggester } from '../electron/main/infra/sidecar-mapping-suggester'
import { readXlsx } from '../electron/main/infra/xlsx-reader'
import { AutoTagService } from '../electron/main/services/auto-tag-service'
import { ColumnPeriodService } from '../electron/main/services/column-period-service'
import { ValidationError } from '../electron/main/services/errors'
import { MappingService } from '../electron/main/services/mapping-service'
import type { MappingSuggester, SuggestRequest } from '../electron/main/services/ports'
import { ProjectService } from '../electron/main/services/project-service'
import { SourceService } from '../electron/main/services/source-service'
import { TableMappingService } from '../electron/main/services/table-mapping-service'
import { TableSuggestionService } from '../electron/main/services/table-suggestion-service'
import { SidecarManager } from '../electron/main/sidecar'

const AUTHORITY = resolve(__dirname, '../../engine/authority/ci-2016.authority.json')
const SAMPLE = resolve(__dirname, '../../data/sample_financials.xlsx')
const REPO = resolve(__dirname, '../..')

let sidecar: SidecarManager
beforeAll(async () => {
  sidecar = new SidecarManager({ isPackaged: false, repoRoot: REPO, resourcesPath: '' })
  void sidecar.start()
  await sidecar.whenReady(170_000)
}, 180_000)
afterAll(async () => {
  await sidecar?.stop()
})

/** The real suggester, recording what it was sent. */
class RecordingSuggester implements MappingSuggester {
  requests: SuggestRequest[] = []
  constructor(private readonly inner: MappingSuggester) {}
  suggest(req: SuggestRequest) {
    this.requests.push(req)
    return this.inner.suggest(req)
  }
}

describe.skipIf(!existsSync(AUTHORITY))('auto-tagging on the sample workbook', () => {
  let db: AppDatabase
  let projects: ProjectService
  let mapping: MappingService
  let suggester: RecordingSuggester
  let autoTag: AutoTagService
  const cell = (sheet: string, ref: string): CellRef => ({ workbook: 'workbook-1.xlsx', sheet, ref })
  const at = (sheet: string, ref: string) => mapping.list().find((m) => m.cell.sheet === sheet && m.cell.ref === ref)

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xap-autotag-'))
    db = new AppDatabase(':memory:')
    projects = new ProjectService({ authority: new FileAuthorityProvider(AUTHORITY), recents: db, autosave: new DirAutosaveStore(dir), appVersion: '0.1.0' })
    const sources = new SourceService(projects, readXlsx)
    const columns = new ColumnPeriodService(projects, sources)
    mapping = new MappingService(projects, sources, columns, db)
    suggester = new RecordingSuggester(new SidecarMappingSuggester(sidecar))
    const tables = new TableSuggestionService(projects, new TableMappingService(projects, sources, columns, mapping))
    autoTag = new AutoTagService(projects, sources, mapping, suggester, db, tables)
    await projects.newFiling({
      companyName: 'XBRL Ltd',
      cin: 'U72200KA2010PLC123456',
      reportType: 'Standalone',
      cy: { start: '2013-04-01', end: '2014-03-31' },
      py: { start: '2012-04-01', end: '2013-03-31' },
      level: 'Actual',
    })
    await sources.importWorkbook('sample_financials.xlsx', readFileSync(SAMPLE))
  })

  it('stores suggestions and writes no fact', async () => {
    const facts = () => (projects.project().session.filing as unknown as { facts: Map<string, unknown> }).facts.size
    const before = facts()
    const summary = await autoTag.run()
    expect(facts()).toBe(before)
    expect(summary.suggested).toBeGreaterThan(30)
    expect(summary.llmUsed).toBe(false)
    expect(summary.sheets.map((s) => [s.sheet, s.kind])).toEqual([['BS', 'balance_sheet'], ['PL', 'profit_loss'], ['BS Sch', 'balance_sheet']])
    const sc = at('BS', 'C9')!
    expect(sc).toMatchObject({ status: 'suggested', origin: 'exact', fact: { concept: 'in-gaap:ShareCapital', scope: 'CY' }, factKey: null, value: null })
    expect(sc.confidence).toBeGreaterThanOrEqual(0.9)
    expect(sc.rationale).toMatch(/label/)
    expect(at('BS', 'D9')!.fact.scope).toBe('PY')
    // what was sent: values only, the filing's period ends, LLM off without consent
    const req = suggester.requests[0]!
    expect(req).toMatchObject({ taxonomy: 'ci-2016', periods: { cyEnd: '2014-03-31', pyEnd: '2013-03-31' }, level: 'Actual', useLlm: false })
    expect(Object.keys(req.sheets[0]!.cells[0]!).sort()).toEqual(['c', 'r', 'v'])
  }, 60_000)

  it('accepts a suggestion through tag(): the fact, its provenance and the mapping memory', async () => {
    await autoTag.run()
    const id = at('BS', 'C9')!.id
    const m = await autoTag.accept(id)
    expect(m).toMatchObject({ status: 'approved', origin: 'exact', value: '60000000', fact: { concept: 'in-gaap:ShareCapital', scope: 'CY' } })
    expect(m.confidence).toBeGreaterThanOrEqual(0.9)
    expect(db.recall('ci-2016')).toEqual([{ label: '- share capital', concept: 'in-gaap:ShareCapital', approvals: 1 }])
    // the memory goes with the next run and wins
    await autoTag.run()
    expect(suggester.requests[1]!.memory).toHaveLength(1)
    expect(at('BS', 'C9')!.status).toBe('approved') // a tagged cell is not suggested again
    expect(at('BS', 'D9')).toMatchObject({ status: 'suggested', origin: 'memory' })
  }, 60_000)

  it('rejects a suggestion and does not suggest it again', async () => {
    await autoTag.run()
    const id = at('BS', 'C10')!.id
    expect(autoTag.reject(id).status).toBe('rejected')
    await expect(autoTag.accept(id)).rejects.toThrow(ValidationError)
    await autoTag.run()
    expect(mapping.list().filter((m) => m.cell.sheet === 'BS' && m.cell.ref === 'C10')).toMatchObject([{ status: 'rejected' }])
  })

  it('accepts an alternative instead, as a manual choice', async () => {
    await autoTag.run()
    const s = mapping.list().find((m) => m.status === 'suggested' && (m.alternatives?.length ?? 0) > 0)!
    await expect(autoTag.accept(s.id, 'in-gaap:NotOffered')).rejects.toThrow(ValidationError)
    const alt = s.alternatives![0]!.concept
    const m = await autoTag.accept(s.id, alt).catch((e: unknown) => e)
    if (m instanceof ValidationError) return // an alternative may be refused by the engine (e.g. a period clash); then nothing changed
    expect(m).toMatchObject({ status: 'approved', origin: 'manual', fact: { concept: alt } })
  })

  it('accept all ≥ 0.9 tags the confident ones and leaves the rest suggested', async () => {
    await autoTag.run()
    const before = mapping.list().filter((m) => m.status === 'suggested')
    const sure = before.filter((m) => (m.confidence ?? 0) >= 0.9).length
    const r = await autoTag.acceptAll(0.9)
    expect(r.accepted + r.problems.length).toBe(sure)
    expect(r.accepted).toBeGreaterThan(20)
    const left = mapping.list().filter((m) => m.status === 'suggested')
    expect(left.every((m) => (m.confidence ?? 0) < 0.9 || r.problems.some((p) => p.startsWith(`${m.cell.sheet}!${m.cell.ref}:`)))).toBe(true)
    expect(at('PL', 'C6')).toMatchObject({ status: 'approved', fact: { concept: 'in-gaap:RevenueFromOperations' } })
  })

  it('untagging or re-scoping a suggestion never touches another cell’s fact', async () => {
    await mapping.tag({ cell: cell('BS', 'C9'), concept: 'in-gaap:ShareCapital' })
    mapping.replaceSuggestions([
      { cell: cell('BS', 'C10'), label: 'x', concept: 'in-gaap:ShareCapital', scope: 'PY', sign: 1, origin: 'lexical', confidence: 0.5, rationale: 'r', alternatives: [] },
    ])
    const s = at('BS', 'C10')!
    expect(s.factKey).toBeNull()
    expect((await mapping.setScope(s.id, 'CY')).fact.scope).toBe('CY')
    mapping.untag(s.id)
    expect(at('BS', 'C9')!.value).toBe('60000000')
    expect(() => mapping.setStatus(at('BS', 'C9')!.id, 'suggested')).toThrow(ValidationError)
  })
})
