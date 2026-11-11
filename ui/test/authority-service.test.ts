/**
 * AuthorityService (ADR-0010, ADR-0011): taxonomy half + rules half (both sidecar routes) → one engine Authority per
 * taxonomy. The unit tests use the knowledge-base files as the routes so they run without a sidecar; the routes
 * themselves are covered by tests/test_engine_authority.py, tests/test_engine_rules.py and the editor tests.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { NewFilingInput } from '@shared/project'
import { AppDatabase } from '../electron/main/infra/app-database'
import { DirAutosaveStore } from '../electron/main/infra/dir-autosave-store'
import { readAxbrl } from '../electron/main/project/axbrl'
import { AuthorityService } from '../electron/main/services/authority-service'
import { ValidationError } from '../electron/main/services/errors'
import { ProjectService } from '../electron/main/services/project-service'
import { KB_RULE_FILES, KbAuthoritySource, KbRuleBundleSource, kbReady } from './helpers/kb-authorities'

const input = (over: Partial<NewFilingInput> = {}): NewFilingInput => ({
  companyName: 'Dixon Global Pvt Ltd',
  cin: 'U51900UP2010PTC042400',
  reportType: 'Standalone',
  cy: { start: '2025-04-01', end: '2026-03-31' },
  py: { start: '2024-04-01', end: '2025-03-31' },
  level: 'Lakhs',
  ...over,
})

describe.skipIf(!kbReady)('AuthorityService', () => {
  const kb = new KbAuthoritySource()
  const service = new AuthorityService(kb, new KbRuleBundleSource())

  it('assembles C&I 2016 with its compiled business rules', async () => {
    const loaded = await service.load('ci-2016')
    expect(loaded.taxonomyId).toBe('ci-2016')
    expect(loaded.authority.rules.rules.length).toBeGreaterThan(1000)
    expect(loaded.hash).toBe(JSON.parse(readFileSync(KB_RULE_FILES['ci-2016']!, 'utf8')).meta.authorityHash)
  })

  it('assembles Ind AS 2017 with its business rules (ADR-0011)', async () => {
    const loaded = await service.load('ind-as-2017')
    expect(loaded.authority.meta.schemaRef).toBe('https://www.mca.gov.in/V3XBRL/2017/07/16/Taxonomy/Ind/in-ci-ent-2017-03-31.xsd')
    expect(loaded.authority.rules.rules.length).toBeGreaterThan(1300)
    expect(loaded.hash).toBe(JSON.parse(readFileSync(KB_RULE_FILES['ind-as-2017']!, 'utf8')).meta.authorityHash)
  })

  it('loads each taxonomy once and retries after a failure', async () => {
    const before = kb.calls
    await service.load('ci-2016')
    expect(kb.calls).toBe(before)
    const fresh = new AuthorityService(kb, new KbRuleBundleSource())
    kb.failNext = true
    await expect(fresh.load('ind-as-2017')).rejects.toThrow('sidecar restarting')
    await expect(fresh.load('ind-as-2017')).resolves.toMatchObject({ taxonomyId: 'ind-as-2017' })
  })

  it('creates, saves and reopens an Ind AS filing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xap-indas-'))
    const projects = new ProjectService({
      authority: service,
      recents: new AppDatabase(':memory:'),
      autosave: new DirAutosaveStore(join(dir, 'autosave')),
      appVersion: '0.1.0',
    })
    const s = await projects.newFiling(input({ taxonomy: 'ind-as-2017' }))
    expect(s.taxonomy).toBe('ind-as-2017')
    expect(projects.session().getValue('in-ca:NameOfCompany', 'CY').value).toBe('Dixon Global Pvt Ltd')
    projects.session().setValue('ind-as:EquityShareCapital', 'CY', '100')
    const file = join(dir, 'dixon.axbrl')
    await projects.saveAs(file)
    expect((await readAxbrl(file)).content.manifest.taxonomy.id).toBe('ind-as-2017')
    await projects.close()
    const reopened = await projects.open(file)
    expect(reopened.taxonomy).toBe('ind-as-2017')
    expect(projects.session().getValue('ind-as:EquityShareCapital', 'CY').value).toBe('10000000')
    // a nearly empty filing has open business-rule errors now that Ind AS has rules (Phase 9): export anyway to see the schemaRef
    expect(projects.session().exportXml({ today: '2026-11-10', allowErrors: true }).xml).toContain('/Taxonomy/Ind/in-ci-ent-2017-03-31.xsd')
  })

  it('refuses a taxonomy that cannot be filed yet', async () => {
    const projects = new ProjectService({ authority: service, recents: new AppDatabase(':memory:'), autosave: new DirAutosaveStore(mkdtempSync(join(tmpdir(), 'xap-'))), appVersion: '0.1.0' })
    await expect(projects.newFiling(input({ taxonomy: 'costing-2019' }))).rejects.toBeInstanceOf(ValidationError)
  })
})
