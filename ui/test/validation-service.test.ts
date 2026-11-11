/**
 * ValidationService + McaToolService (Phase 9) on a real C&I filing (knowledge-base authority with the business
 * rules, no sidecar): live problems with location and source cell (approved mappings only), quick fix through the
 * engine, MCA error import kept in the project, debounce, MCA tool launch through ports.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MappingView } from '@shared/editor'
import type { NewFilingInput } from '@shared/project'
import { AppDatabase } from '../electron/main/infra/app-database'
import { DirAutosaveStore } from '../electron/main/infra/dir-autosave-store'
import { readAxbrl } from '../electron/main/project/axbrl'
import { ValidationError } from '../electron/main/services/errors'
import { McaToolService, nextOutputName, type OutputWriter, type ToolLauncher } from '../electron/main/services/mca-tool-service'
import { ProjectService } from '../electron/main/services/project-service'
import { ValidationService } from '../electron/main/services/validation-service'
import { kbAuthorityService, kbReady } from './helpers/kb-authorities'

const input = (over: Partial<NewFilingInput> = {}): NewFilingInput => ({
  companyName: 'Helmier Private Limited',
  cin: 'U74999DL2015PTC123456',
  reportType: 'Standalone',
  cy: { start: '2025-04-01', end: '2026-03-31' },
  py: { start: '2024-04-01', end: '2025-03-31' },
  level: 'Lakhs',
  ...over,
})

const mapping = (over: Partial<MappingView>): MappingView =>
  ({
    id: 'm1',
    cell: { workbook: 'workbook-1.xlsx', sheet: 'BS', ref: 'D10' },
    label: 'Share capital',
    fact: { concept: 'in-gaap:ShareCapital', scope: 'PY', dims: [] },
    sign: 1,
    origin: 'manual',
    confidence: null,
    status: 'approved',
    conceptLabel: 'Share capital',
    factKey: null,
    value: null,
    alsoViews: [],
    ...over,
    factKeys: over.factKeys ?? (over.factKey ? [over.factKey] : []),
  }) as MappingView

describe.skipIf(!kbReady)('ValidationService', () => {
  let projects: ProjectService
  let mappings: MappingView[]
  let pushed: number
  let service: ValidationService
  const dir = mkdtempSync(join(tmpdir(), 'xap-validation-'))

  beforeEach(() => {
    projects = new ProjectService({ authority: kbAuthorityService(), recents: new AppDatabase(':memory:'), autosave: new DirAutosaveStore(join(dir, 'autosave')), appVersion: '0.1.0' })
    mappings = []
    pushed = 0
    service = new ValidationService(projects, () => mappings, () => pushed++, { delayMs: 50, today: () => '2026-11-11' })
  })
  afterEach(() => service.dispose())

  it('gives an empty view without a filing', () => {
    const v = service.run()
    expect(v.problems).toEqual([])
    expect(v.at).toBeNull()
    expect(pushed).toBe(1)
  })

  it('validates a new C&I filing with its business rules and reports the rule coverage', async () => {
    await projects.newFiling(input())
    const v = service.run()
    expect(v.summary.errors).toBeGreaterThan(0)
    expect(v.problems.every((p) => p.source === 'engine')).toBe(true)
    expect(v.coverage).toMatchObject({ executable: 962, reviewOnly: 48, unimplemented: 1, executableShare: 0.9515 })
    // a rule problem located on a statement row
    const located = v.problems.find((p) => p.family === 'rule' && p.location?.elrUri)
    expect(located?.location?.elrTitle).toBeTruthy()
    expect(v.revision).toBeGreaterThan(0)
  })

  it('points a problem to the Excel cell of an approved mapping, never to a suggestion', async () => {
    await projects.newFiling(input())
    const S = projects.project().session
    S.setValue('in-gaap:ShareCapital', 'PY', '100') // PY without CY: CY/PY pairing (GR-6) fails on this fact
    const fact = S.getValue('in-gaap:ShareCapital', 'PY', []) as { key: string }
    mappings = [
      mapping({ id: 's', status: 'suggested', factKey: fact.key, cell: { workbook: 'workbook-1.xlsx', sheet: 'BS', ref: 'Z99' } }),
      mapping({ id: 'r', status: 'rejected', factKey: fact.key, cell: { workbook: 'workbook-1.xlsx', sheet: 'BS', ref: 'Y98' } }),
    ]
    const pairing = () => service.run().problems.find((p) => p.ruleId === 'GR-6' && p.location?.factKey === fact.key)
    expect(pairing()?.cell).toBeNull()
    mappings.push(mapping({ id: 'a', status: 'approved', factKey: fact.key }))
    expect(pairing()?.cell).toEqual({ workbook: 'workbook-1.xlsx', sheet: 'BS', ref: 'D10' })
  })

  it('applies a quick fix through the engine and revalidates', async () => {
    await projects.newFiling(input())
    const S = projects.project().session
    S.setValue('in-gaap:ShareCapital', 'PY', '0')
    const v = service.run()
    const p = v.problems.find((x) => x.ruleId === 'GR-6' && x.fix)
    expect(p?.fix?.label).toBeTruthy()
    const after = service.applyFix(p!.id)
    expect(after.problems.find((x) => x.ruleId === 'GR-6' && x.location?.concept === 'in-gaap:ShareCapital' && x.severity === 'error')).toBeUndefined()
    expect(S.getValue('in-gaap:ShareCapital', 'CY', [])).not.toBeNull()
    expect(() => service.applyFix('engine:gone#1')).toThrow(ValidationError)
  })

  it('imports, explains, saves and clears the MCA tool error list', async () => {
    await projects.newFiling(input())
    const text = [
      "1) cvc-datatype-valid.1.2.1: 'abc' is not a valid value for 'decimal'.",
      "2) cvc-type.3.1.3: The value 'abc' of element 'in-gaap:ShareCapital' is not valid.",
    ].join('\n')
    const v = service.importMcaErrors(text, 'mca errors.txt')
    const mca = v.problems.filter((p) => p.source === 'mca')
    expect(mca).toHaveLength(2)
    expect(v.mca).toEqual({ file: 'mca_errors', count: 2 })
    expect(mca.some((p) => p.location?.concept === 'in-gaap:ShareCapital')).toBe(true)
    expect(mca.every((p) => p.explanation?.meaning)).toBe(true)
    const file = join(dir, 'with-mca.axbrl')
    await projects.saveAs(file)
    const saved = (await readAxbrl(file)).content.mcaErrors
    expect(Object.values(saved)).toEqual([text])
    const cleared = service.clearMcaErrors()
    expect(cleared.problems.some((p) => p.source === 'mca')).toBe(false)
    expect(() => service.importMcaErrors('  ')).toThrow(ValidationError)
  })

  it('debounces a burst of changes into one run', async () => {
    vi.useFakeTimers()
    try {
      await projects.newFiling(input())
      const before = pushed
      service.schedule()
      service.schedule()
      service.schedule()
      vi.advanceTimersByTime(60)
      expect(pushed).toBe(before + 1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe.skipIf(!kbReady)('McaToolService', () => {
  class MemoryWriter implements OutputWriter {
    files: { projectPath: string | null; name: string; text: string }[] = []
    async write(projectPath: string | null, name: string, text: string) {
      this.files.push({ projectPath, name, text })
      return `/out/${name}`
    }
  }
  class RecordingLauncher implements ToolLauncher {
    launched: string[] = []
    async launch(program: string) {
      this.launched.push(program)
    }
  }

  it('writes output/NNN.xml into the project and starts the tool', async () => {
    const projects = new ProjectService({ authority: kbAuthorityService(), recents: new AppDatabase(':memory:'), autosave: new DirAutosaveStore(mkdtempSync(join(tmpdir(), 'xap-'))), appVersion: '0.1.0' })
    await projects.newFiling(input())
    const writer = new MemoryWriter()
    const launcher = new RecordingLauncher()
    const tool = new McaToolService(projects, () => 'C:/MCA/MCA_XBRL_Valiation_Tool_V5.1.exe', writer, launcher, () => '2026-11-11')
    const r1 = await tool.launch()
    const r2 = await tool.launch()
    expect([r1.xmlPath, r2.xmlPath]).toEqual(['/out/001.xml', '/out/002.xml'])
    expect(r1.validated).toBe(false) // a new filing still has open errors: written, marked NOT VALIDATED
    expect(writer.files[0]!.text).toContain('NOT VALIDATED')
    expect(Object.keys(projects.project().content.outputs)).toEqual(['001.xml', '002.xml'])
    expect(launcher.launched).toEqual(['C:/MCA/MCA_XBRL_Valiation_Tool_V5.1.exe', 'C:/MCA/MCA_XBRL_Valiation_Tool_V5.1.exe'])
  })

  it('asks for the tool path when it cannot be found', async () => {
    const projects = new ProjectService({ authority: kbAuthorityService(), recents: new AppDatabase(':memory:'), autosave: new DirAutosaveStore(mkdtempSync(join(tmpdir(), 'xap-'))), appVersion: '0.1.0' })
    await projects.newFiling(input())
    const tool = new McaToolService(projects, () => null, new MemoryWriter(), new RecordingLauncher())
    await expect(tool.launch()).rejects.toBeInstanceOf(ValidationError)
  })

  it('numbers outputs after the highest existing one', () => {
    expect(nextOutputName([])).toBe('001.xml')
    expect(nextOutputName(['001.xml', '007.xml', 'notes.txt'])).toBe('008.xml')
  })
})
