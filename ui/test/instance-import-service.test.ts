/**
 * Phase 7: a filing from an existing XBRL instance. Dixon (Ind AS, Webtel, MCA-accepted) is real client data and
 * stays in this process (docs/12-reference-data.md).
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildExample, compareInstanceFacts, Session } from '@xap/engine'
import { AppDatabase } from '../electron/main/infra/app-database'
import { DirAutosaveStore } from '../electron/main/infra/dir-autosave-store'
import { readAxbrl } from '../electron/main/project/axbrl'
import { ValidationError } from '../electron/main/services/errors'
import { InstanceImportService } from '../electron/main/services/instance-import-service'
import { ProjectService } from '../electron/main/services/project-service'
import { kbAuthorityService, kbReady } from './helpers/kb-authorities'

const DIXON = resolve(__dirname, '../../data/Instance_Dixon_Global_Private_2025-26_001.xml')
const clock = { now: () => new Date(Date.UTC(2026, 10, 10, 10, 0, 0)) }

describe.skipIf(!kbReady || !existsSync(DIXON))('InstanceImportService', () => {
  const authorities = kbAuthorityService()
  const dixon = existsSync(DIXON) ? readFileSync(DIXON, 'utf8') : ''
  let dir: string
  let projects: ProjectService
  let importer: InstanceImportService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xap-import-'))
    projects = new ProjectService({ authority: authorities, recents: new AppDatabase(':memory:'), autosave: new DirAutosaveStore(join(dir, 'autosave')), appVersion: '0.1.0', clock })
    importer = new InstanceImportService(authorities, projects, clock)
  })

  it('opens the Dixon filing as filed, proven by a fact-by-fact round trip', async () => {
    const { summary, report } = await importer.importInstance('Instance_Dixon.xml', dixon, 'both')
    expect(summary).toMatchObject({ taxonomy: 'ind-as-2017', company: { name: 'DIXON GLOBAL PRIVATE LIMITED', cin: 'U51900UP2010PTC042400' }, fyLabel: 'FY 2025-26', dirty: true, path: null })
    expect(report.counts).toMatchObject({ sourceFacts: 2666, imported: 2666, unresolved: 0 })
    expect(report.roundTrip).toMatchObject({ identical: true, equal: 2666 })
    expect(report.conventions.source).toMatchObject({ contextIdStyle: 'descriptive', duplicateContexts: 2 })
    expect(report.conventions.ours).toMatchObject({ contextIdStyle: 'short', duplicateContexts: 0, facts: 2666 })
  })

  it('keeps the instance and its report in the project, and the filing survives save → reopen', async () => {
    await importer.importInstance('Instance_Dixon.xml', dixon, 'both')
    const file = join(dir, 'dixon.axbrl')
    await projects.saveAs(file)
    const { content } = await readAxbrl(file)
    expect(content.manifest.importedFrom).toMatchObject({ fileName: 'Instance_Dixon.xml', entry: 'Instance_Dixon.xml', mode: 'both' })
    expect(content.imports['Instance_Dixon.xml']).toBe(dixon)
    expect(JSON.parse(content.imports['Instance_Dixon.report.json']!).view.roundTrip.identical).toBe(true)
    await projects.close()
    await projects.open(file)
    const xml = projects.session().exportXml({ today: '2026-11-10', allowErrors: true }).xml as string
    expect(compareInstanceFacts(dixon, xml).identical).toBe(true)
  })

  it("starts next year's filing from it", async () => {
    const { summary, report } = await importer.importInstance('Instance_Dixon.xml', dixon, 'next')
    expect(summary).toMatchObject({ taxonomy: 'ind-as-2017', fyLabel: 'FY 2026-27', py: { start: '2025-04-01', end: '2026-03-31' } })
    expect(report.roundTrip).toBeNull()
    // Phase 9: Ind AS GR-11 (no directors'/auditors' report, general information, KMP … for the previous year) keeps
    // 207 of last year's 1,427 current-year facts out of the new previous year (set aside for Copy from previous year)
    expect(report.counts.imported).toBe(1220)
    expect(report.counts.skippedPrevious).toBe(1195 + 44)
  })

  it('recognises a C&I 2016 instance', async () => {
    const ci = await authorities.load('ci-2016')
    const S = new Session(ci.authority)
    buildExample(S)
    const xml = S.exportXml({ today: '2017-09-30' }).xml as string
    const { summary, report } = await importer.importInstance('example.xml', xml, 'both')
    expect(summary.taxonomy).toBe('ci-2016')
    expect(report.roundTrip?.identical).toBe(true)
  })

  it('refuses files it cannot file: another schema, no schemaRef, broken XML', async () => {
    const other = dixon.replace('Taxonomy/Ind/in-ci-ent-2017-03-31.xsd', 'Taxonomy/Cost/in-cost-2019.xsd')
    await expect(importer.importInstance('x.xml', other, 'both')).rejects.toThrow(/not C&I 2016 or Ind AS 2017/)
    await expect(importer.importInstance('x.xml', '<html/>', 'both')).rejects.toBeInstanceOf(ValidationError)
    await expect(importer.importInstance('x.xml', dixon.slice(0, 5000), 'both')).rejects.toBeInstanceOf(ValidationError)
    expect(projects.hasProject()).toBe(false)
  })
})
