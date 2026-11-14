/**
 * docs/14 Step 5: MandatoryInputService (the list labelled by statement, writes through the engine's fact patch, the
 * key answers), GenerateService (writes only a clean filing; the gate's errors refuse it), and the dialog helpers
 * (grouping, input kind, Generate readiness).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { GateError } from '@xap/engine'
import { generateReadiness, groupByStatement, inputKind, type KeyAnswerView } from '@shared/mandatory'
import { AppDatabase } from '../electron/main/infra/app-database'
import { DirAutosaveStore } from '../electron/main/infra/dir-autosave-store'
import { ValidationError } from '../electron/main/services/errors'
import { GenerateService } from '../electron/main/services/generate-service'
import { MandatoryInputService } from '../electron/main/services/mandatory-input-service'
import type { OutputWriter } from '../electron/main/services/mca-tool-service'
import { ProjectService } from '../electron/main/services/project-service'
import { kbAuthorityService, kbReady } from './helpers/kb-authorities'

const CSR = 'in-gaap:WhetherProvisionsOfCorporateSocialResponsibilityAreApplicableOnCompany'
const POLICY = 'in-gaap:WhetherCompanyHasWrittenCSRPolicy'

describe.skipIf(!kbReady)('MandatoryInputService (C&I)', () => {
  let projects: ProjectService
  let service: MandatoryInputService
  const has = (concept: string) => service.list().items.some((i) => i.concept === concept && i.scope === 'CY')

  beforeEach(async () => {
    projects = new ProjectService({ authority: kbAuthorityService(), recents: new AppDatabase(':memory:'), autosave: new DirAutosaveStore(mkdtempSync(join(tmpdir(), 'xap-mand-'))), appVersion: '0.1.0' })
    service = new MandatoryInputService(projects, () => '2026-11-14')
    await projects.newFiling({
      taxonomy: 'ci-2016', companyName: 'Synthetic Pvt Ltd', cin: 'U72200KA2010PTC123456', reportType: 'Standalone',
      cy: { start: '2025-04-01', end: '2026-03-31' }, py: { start: '2024-04-01', end: '2025-03-31' }, level: 'Lakhs', statementPlaces: 2,
    })
  })

  it('lists the empty non-numeric mandatory items with their statement, for the dialog’s groups', () => {
    const { items, tables } = service.list()
    expect(items.length).toBeGreaterThan(10)
    expect(items.every((i) => /^\d{6}$/.test(i.elrCode) && i.elrTitle && i.rules.length)).toBe(true)
    expect(items.find((i) => i.concept === CSR && i.scope === 'CY')).toMatchObject({ dataType: 'boolean', conditional: false })
    expect(tables).toEqual([])
    // the company name typed in the New Filing wizard is not asked again
    expect(has('in-gaap:NameOfCompany')).toBe(false)
  })

  it('writes an answer through the engine: CSR Yes asks for the policy, No closes it; a wrong value is refused', () => {
    service.set({ concept: CSR, scope: 'CY', value: 'true' })
    expect(has(CSR)).toBe(false)
    expect(has(POLICY)).toBe(true)
    service.set({ concept: CSR, scope: 'CY', value: 'false' })
    expect(has(POLICY)).toBe(false)
    expect(() => service.set({ concept: CSR, scope: 'CY', value: 'maybe' })).toThrow(ValidationError)
    expect(() => service.set({ concept: CSR, scope: 'CY', value: '  ' })).toThrow(/Enter a value/)
  })

  it('auditor’s report qualified = Yes lists the remarks table (C&I) as a required table', () => {
    service.set({ concept: 'in-ca:WhetherAuditorsReportHasBeenQualifiedOrHasAnyReservationsOrContainsAdverseRemarks', scope: 'CY', value: 'true' })
    expect(service.list().tables).toEqual([expect.objectContaining({ ruleId: 'SR-L3893-1', scope: 'CY', elrCode: expect.stringMatching(/^\d{6}$/), title: expect.any(String) })])
  })

  it('key answers: the curated four with labels of what each decides', () => {
    const keys = service.keyAnswers()
    expect(keys).toHaveLength(4)
    expect(keys.every((k) => k.value === null)).toBe(true)
    expect(keys.find((k) => k.concept === CSR)!.decides.length).toBeGreaterThan(0)
    service.set({ concept: CSR, scope: 'CY', value: 'false' })
    expect(service.keyAnswers().find((k) => k.concept === CSR)!.value).toBe(false)
  })
})

describe('GenerateService', () => {
  const fake = (exportXml: () => { xml: string }) => {
    const outputs: Record<string, string> = { '001.xml': '<old/>' }
    let touched = 0
    const written: string[] = []
    const writer: OutputWriter = { write: async (_p, name) => (written.push(name), `C:/out/${name}`) }
    const projects = { project: () => ({ session: { exportXml }, content: { outputs }, touch: () => touched++ }), summary: () => ({ path: null }) }
    return { service: new GenerateService(projects as never, writer, () => '2026-11-14'), outputs, written, touched: () => touched }
  }

  it('writes a clean filing as the next output file', async () => {
    const f = fake(() => ({ xml: '<xbrl/>' }))
    expect(await f.service.generate()).toEqual({ xmlPath: 'C:/out/002.xml', name: '002.xml' })
    expect(f.outputs['002.xml']).toBe('<xbrl/>')
    expect(f.written).toEqual(['002.xml'])
    expect(f.touched()).toBe(1)
  })

  it('refuses while the gate finds errors (Fix first), writing nothing', async () => {
    const f = fake(() => {
      throw new GateError({ blocking: 3 })
    })
    await expect(f.service.generate()).rejects.toThrow(/3 validation errors must be fixed/)
    expect(f.written).toEqual([])
  })
})

describe('mandatory dialog helpers', () => {
  const key = (value: boolean | null): KeyAnswerView => ({ concept: 'q', label: 'Q', elrUri: 'e', value, requiredWhen: true, decides: [], rules: [] })

  it('groups by statement in first-seen order; picks the input by data type', () => {
    const rows = [{ elrUri: 'a', elrCode: '400100', elrTitle: 'General' }, { elrUri: 'b', elrCode: '400200', elrTitle: 'Auditor' }, { elrUri: 'a', elrCode: '400100', elrTitle: 'General' }]
    expect(groupByStatement(rows).map((g) => [g.title, g.rows.length])).toEqual([['[400100] General', 2], ['[400200] Auditor', 1]])
    expect(inputKind({ dataType: 'boolean', enumerations: null })).toBe('yesNo')
    expect(inputKind({ dataType: 'date', enumerations: null })).toBe('date')
    expect(inputKind({ dataType: 'enum', enumerations: ['A', 'B'] })).toBe('list')
    expect(inputKind({ dataType: 'textBlock', enumerations: null })).toBe('textBlock')
    expect(inputKind({ dataType: 'string', enumerations: null })).toBe('text')
  })

  it('Generate is ready only when every key answer is given and confirmed and no error remains', () => {
    const empty = { items: [], tables: [] }
    expect(generateReadiness({ keyAnswers: [key(null)], confirmed: true, errors: 0, mandatory: empty })).toMatchObject({ ready: false, unanswered: ['Q'] })
    expect(generateReadiness({ keyAnswers: [key(true)], confirmed: false, errors: 0, mandatory: empty })).toMatchObject({ ready: false, unconfirmed: true })
    expect(generateReadiness({ keyAnswers: [key(false)], confirmed: true, errors: 2, mandatory: empty })).toMatchObject({ ready: false, errors: 2 })
    expect(generateReadiness({ keyAnswers: [key(false)], confirmed: true, errors: 0, mandatory: empty })).toEqual({ ready: true, unanswered: [], unconfirmed: false, errors: 0, pending: 0 })
  })
})
