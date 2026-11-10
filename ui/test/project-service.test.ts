import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { NewFilingInput } from '@shared/project'
import { AppDatabase } from '../electron/main/infra/app-database'
import { DirAutosaveStore } from '../electron/main/infra/dir-autosave-store'
import { FileAuthorityProvider } from '../electron/main/infra/file-authority-provider'
import { readAxbrl } from '../electron/main/project/axbrl'
import { NoSavePathError, ValidationError } from '../electron/main/services/errors'
import { ProjectService, validateNewFiling } from '../electron/main/services/project-service'

const AUTHORITY = resolve(__dirname, '../../engine/authority/ci-2016.authority.json')
const authority = new FileAuthorityProvider(AUTHORITY) // shared: the 6 MB parse happens once

const input = (over: Partial<NewFilingInput> = {}): NewFilingInput => ({
  companyName: 'Acme Pvt Ltd',
  cin: 'U72200KA2010PTC123456',
  reportType: 'Standalone',
  cy: { start: '2025-04-01', end: '2026-03-31' },
  py: { start: '2024-04-01', end: '2025-03-31' },
  level: 'Lakhs',
  ...over,
})

describe('validateNewFiling', () => {
  it('accepts a valid form', () => expect(validateNewFiling(input())).toEqual([]))
  it('lists every problem', () => {
    const p = validateNewFiling(input({ companyName: ' ', cin: 'BAD', py: { start: '2024-04-01', end: '2025-04-30' } }))
    expect(p).toHaveLength(3)
    expect(p.join(' ')).toMatch(/company name/)
    expect(p.join(' ')).toMatch(/CIN/)
    expect(p.join(' ')).toMatch(/Previous year must end/)
  })
})

describe.skipIf(!existsSync(AUTHORITY))('ProjectService', () => {
  let dir: string
  let db: AppDatabase
  let svc: ProjectService
  let ticks = 0
  const make = () =>
    new ProjectService({
      authority,
      recents: db,
      autosave: new DirAutosaveStore(join(dir, 'autosave')),
      appVersion: '0.1.0',
      clock: { now: () => new Date(Date.UTC(2026, 10, 10, 10, 0, ticks++)) },
    })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xap-proj-'))
    db = new AppDatabase(':memory:')
    svc = make()
  })

  it('creates a filing whose meta is mirrored into General Information facts', async () => {
    const s = await svc.newFiling(input())
    expect(s).toMatchObject({ path: null, dirty: true, company: { name: 'Acme Pvt Ltd', cin: 'U72200KA2010PTC123456' }, fyLabel: 'FY 2025-26', level: 'Lakhs' })
    expect(s.factCount).toBeGreaterThan(0) // CIN, dates, rounding level, company name
  })

  it('rejects an invalid form with all problems', async () => {
    await expect(svc.newFiling(input({ cin: 'nope' }))).rejects.toBeInstanceOf(ValidationError)
    expect(svc.hasProject()).toBe(false)
  })

  it('asks for a path on first save, then saves losslessly and reopens identically', async () => {
    await svc.newFiling(input())
    await expect(svc.save()).rejects.toBeInstanceOf(NoSavePathError)
    const file = join(dir, 'acme.axbrl')
    const saved = await svc.saveAs(file)
    expect(saved).toMatchObject({ path: file, fileName: 'acme.axbrl', dirty: false })
    const xmlBefore = svc.session().exportXml({ allowErrors: true, today: '2026-09-30' }).xml
    const jsonBefore = svc.session().filing.toJSON()

    const other = make()
    const reopened = await other.open(file)
    expect(reopened.dirty).toBe(false)
    expect(reopened.company).toEqual(saved.company)
    expect(other.session().filing.toJSON()).toEqual(jsonBefore)
    expect(other.session().exportXml({ allowErrors: true, today: '2026-09-30' }).xml).toBe(xmlBefore)

    const { content } = await readAxbrl(file)
    expect(content.manifest).toMatchObject({ format: 'axbrl', company: { name: 'Acme Pvt Ltd' }, taxonomy: { id: 'ci-2016' } })
  })

  it('tracks dirty state from engine revisions and records recents', async () => {
    await svc.newFiling(input())
    const file = join(dir, 'acme.axbrl')
    await svc.saveAs(file)
    expect(svc.isDirty()).toBe(false)
    svc.session().setMeta({ name: 'Acme Private Limited' })
    expect(svc.isDirty()).toBe(true)
    await svc.save()
    expect(svc.isDirty()).toBe(false)
    expect(svc.recentProjects()).toEqual([
      expect.objectContaining({ path: file, company: 'Acme Private Limited', fy: 'FY 2025-26', exists: true }),
    ])
  })

  it('first financial year: no previous year', async () => {
    const s = await svc.newFiling(input({ py: null }))
    expect(s.firstFinancialYear).toBe(true)
    expect(s.py).toBeNull()
  })

  it('autosaves unsaved work and recovers it after a crash', async () => {
    await svc.newFiling(input())
    svc.session().setMeta({ name: 'Unsaved Co' })
    expect(await svc.autosaveNow()).toBe(true)

    const afterCrash = make() // new process: nothing open
    const items = await afterCrash.recoveryItems()
    expect(items).toEqual([expect.objectContaining({ company: 'Unsaved Co', fy: 'FY 2025-26', originalPath: null })])
    const recovered = await afterCrash.recover(items[0]!.id)
    expect(recovered).toMatchObject({ dirty: true, company: { name: 'Unsaved Co' } })

    await afterCrash.saveAs(join(dir, 'recovered.axbrl'))
    expect(await afterCrash.recoveryItems()).toEqual([])
    expect(await make().recoveryItems()).toEqual([]) // the autosave copy is gone after saving
  })

  it('does not autosave a clean project, and close removes the recovery copy', async () => {
    await svc.newFiling(input())
    await svc.saveAs(join(dir, 'a.axbrl'))
    expect(await svc.autosaveNow()).toBe(false)
    svc.session().setMeta({ name: 'Changed' })
    await svc.autosaveNow()
    await svc.close()
    expect(svc.summary()).toBeNull()
    expect(await make().recoveryItems()).toEqual([])
  })
})
