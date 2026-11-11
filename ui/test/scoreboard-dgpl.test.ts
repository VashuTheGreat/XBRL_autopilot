/**
 * Engine-side scoreboard (ADR-0013, Phase 11 step 3b): the real app pipeline on DGPL with the real sidecar, LLM off —
 * auto-tag → accept every suggestion (cells, table blocks, "also" facts) → parent-member roll-ups (automatic) → table
 * zeros and statement zeros — and the filing it gives compared with Dixon's MCA-accepted instance, per origin:
 * - excel:   facts written from a cell (a mapping's main or "also" fact);
 * - derived: facts the engine calculated (totals, roll-ups, carrying amounts, closing balances);
 * - zero:    zeros the rule-driven fills added.
 * Floors are committed below; raise them when a producer improves. Client data stays in this process: the sidecar is
 * local and the LLM is off (docs/12).
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { importXbrl } from '@xap/engine'
import { AppDatabase } from '../electron/main/infra/app-database'
import { DirAutosaveStore } from '../electron/main/infra/dir-autosave-store'
import { SidecarMappingSuggester } from '../electron/main/infra/sidecar-mapping-suggester'
import { sidecarXlsReader, workbookParser } from '../electron/main/infra/workbook-parser'
import { readXlsx } from '../electron/main/infra/xlsx-reader'
import { AutoTagService } from '../electron/main/services/auto-tag-service'
import { ColumnPeriodService } from '../electron/main/services/column-period-service'
import { MappingService } from '../electron/main/services/mapping-service'
import { ProjectService } from '../electron/main/services/project-service'
import { SourceService } from '../electron/main/services/source-service'
import { StatementService } from '../electron/main/services/statement-service'
import { TableMappingService } from '../electron/main/services/table-mapping-service'
import { TableSuggestionService } from '../electron/main/services/table-suggestion-service'
import { SidecarManager } from '../electron/main/sidecar'
import { scoreboardText, scoreFacts, type ScoredFact } from './helpers/fact-scoreboard'
import { kbAuthorityService, kbReady } from './helpers/kb-authorities'

const REPO = resolve(__dirname, '../..')
const DGPL = resolve(REPO, 'data/BS DGPL Mar-2026-V1.xls')
const DIXON = resolve(REPO, 'data/Instance_Dixon_Global_Private_2025-26_001.xml')

type Fact = ScoredFact & { key: string; origin?: string }
type Issue = { severity: string; ruleId?: string; code?: string }

describe.skipIf(!kbReady || !existsSync(DGPL) || !existsSync(DIXON))('scoreboard: the app pipeline on DGPL vs Dixon (LLM off)', () => {
  let sidecar: SidecarManager
  beforeAll(async () => {
    sidecar = new SidecarManager({ isPackaged: false, repoRoot: REPO, resourcesPath: '' })
    void sidecar.start()
    await sidecar.whenReady(170_000)
  }, 180_000)
  afterAll(async () => {
    await sidecar?.stop()
  })

  it('auto-tag → accept all → roll-ups → zeros, scored per origin', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xap-score-'))
    const projects = new ProjectService({ authority: kbAuthorityService(), recents: new AppDatabase(':memory:'), autosave: new DirAutosaveStore(dir), appVersion: '0.1.0' })
    const sources = new SourceService(projects, workbookParser({ xlsx: readXlsx, xls: sidecarXlsReader(sidecar) }))
    const columns = new ColumnPeriodService(projects, sources)
    const mapping = new MappingService(projects, sources, columns)
    const tables = new TableMappingService(projects, sources, columns, mapping)
    const suggestions = new TableSuggestionService(projects, tables)
    const autoTag = new AutoTagService(projects, sources, mapping, new SidecarMappingSuggester(sidecar), { recall: () => [], remember: () => {} }, suggestions)
    const statements = new StatementService(projects)
    await projects.newFiling({
      taxonomy: 'ind-as-2017', companyName: 'Synthetic Pvt Ltd', cin: 'U72200KA2010PTC123456', reportType: 'Standalone',
      cy: { start: '2025-04-01', end: '2026-03-31' }, py: { start: '2024-04-01', end: '2025-03-31' }, level: 'Lakhs', statementPlaces: 2,
    })
    await sources.importWorkbook('BS DGPL Mar-2026-V1.xls', new Uint8Array(readFileSync(DGPL)))
    const p = projects.project()
    const A = p.authority.authority as unknown as { elrs: { uri: string }[]; tables: { presentationElr: string }[] }
    const facts = () => (p.session.filing as unknown as { all(): Fact[] }).all()
    const wizard = new Set(facts().map((f) => f.key)) // the new filing's own facts (company, periods)

    // 1. auto-tag and accept everything it suggests: cells, blocks, then each "also" fact
    const summary = await autoTag.run()
    const accepted = await autoTag.acceptAll(0)
    let also = 0
    for (const m of mapping.list().filter((x) => x.status === 'approved' && x.alsoSuggested?.length)) {
      for (let i = m.alsoSuggested!.length - 1; i >= 0; i--) {
        try {
          await mapping.acceptAlso(m.id, i)
          also++
        } catch {
          // refused by the engine (e.g. the fact comes from another cell): stays suggested
        }
      }
    }
    // 2. roll-ups ran with every tag; 3. zeros from the rules: tables, then statements, then tables again (fixpoint)
    const fromExcel = new Set(mapping.list().flatMap((m) => m.factKeys))
    const beforeZeros = new Set(facts().map((f) => f.key))
    const tableElrs = [...new Set(A.tables.map((t) => t.presentationElr))].filter(Boolean)
    for (let round = 0; round < 2; round++) {
      for (const uri of tableElrs) statements.fillTableZeros(uri)
      for (const e of A.elrs) {
        try {
          statements.fillMandatoryZeros(e.uri)
        } catch {
          // an ELR the filing doesn't use
        }
      }
    }
    const zeros = new Set(facts().filter((f) => !beforeZeros.has(f.key) && f.origin !== 'calculated' && Number(f.value) === 0).map((f) => f.key))

    // score against Dixon
    const { filing: dixon } = importXbrl(p.authority.authority, readFileSync(DIXON, 'utf8'), { fileName: 'dixon.xml' }) as unknown as { filing: { all(): Fact[] } }
    const originOf = (f: ScoredFact) => {
      const k = (f as Fact).key
      if (wizard.has(k)) return null
      if (fromExcel.has(k)) return 'excel'
      if (zeros.has(k)) return 'zero'
      return (f as Fact).origin === 'calculated' ? 'derived' : 'other'
    }
    const cellOf = new Map(mapping.list().flatMap((m) => m.factKeys.map((k) => [k, `${m.cell.sheet.trim()}!${m.cell.ref}`] as const)))
    const board = scoreFacts(facts(), dixon.all(), originOf, (f) => cellOf.get((f as Fact).key) ?? '')
    const errors = ((p.session.validate({ today: '2026-11-11' }) as { issues: Issue[] }).issues).filter((i) => i.severity === 'ERROR')
    const byRule = Object.entries(errors.reduce<Record<string, number>>((m, e) => ((m[e.ruleId ?? e.code ?? '?'] = (m[e.ruleId ?? e.code ?? '?'] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 12)
    console.log(
      [
        `suggested ${summary.suggested} cells, ${summary.blocks} blocks; accepted ${accepted.accepted} cells, ${accepted.blocks} blocks (${accepted.cells} cells), ${also} also; ${accepted.problems.length} refused`,
        scoreboardText(board),
        `ERRORs: ${errors.length} — ${byRule.map(([r, n]) => `${r}×${n}`).join(', ')}`,
        `wrong (first 40):\n  ${board.wrong.slice(0, 40).join('\n  ')}`,
      ].join('\n'),
    )
    // ADR-0013 exit targets (reported; not met yet): amounts right ≥ 160 and wrong ≤ 25; non-zero table amounts right
    // ≥ 190 of the 270 in a presentation sheet and wrong ≤ 10% of those produced
    const o = board.byOrigin
    const amounts = { right: o.excel!.amount.right + o.derived!.amount.right, wrong: o.excel!.amount.wrong + o.derived!.amount.wrong }
    console.log(`ADR-0013 targets: amounts right ${amounts.right} (≥ 160), wrong ${amounts.wrong} (≤ 25); non-zero table amounts right ${board.rightNonZero.table} (≥ 190)`)

    // floors (2026-11-11): raise them when a producer improves; a drop is a regression
    expect(summary).toMatchObject({ suggested: 299, blocks: 3 })
    expect(o.excel!.amount.right).toBeGreaterThanOrEqual(137)
    expect(o.excel!.amount.wrong).toBeLessThanOrEqual(45)
    expect(o.excel!.table.right).toBeGreaterThanOrEqual(65)
    expect(o.excel!.table.wrong).toBe(0)
    expect(o.derived!.amount.right).toBeGreaterThanOrEqual(31)
    expect(o.derived!.amount.wrong).toBeLessThanOrEqual(23)
    expect(o.derived!.table.right).toBeGreaterThanOrEqual(78)
    expect(o.derived!.table.wrong).toBeLessThanOrEqual(8)
    expect(o.zero!.amount.right).toBeGreaterThanOrEqual(92)
    expect(o.zero!.amount.wrong).toBeLessThanOrEqual(14)
    expect(o.zero!.table.right).toBeGreaterThanOrEqual(10)
    expect(o.zero!.table.wrong).toBeLessThanOrEqual(24)
    expect(board.rightNonZero.amount).toBeGreaterThanOrEqual(116)
    expect(board.rightNonZero.table).toBeGreaterThanOrEqual(47)
    expect(errors.length).toBeLessThanOrEqual(309)
  }, 600_000)
})
