/**
 * Fixture guard (ADR-0012) on the repository's data/ folder: every client file is known (by content and name), the
 * synthetic sample workbook is not, and without data/ (the packaged app) the guard is a no-op.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fixtureGuardFrom } from '../electron/main/infra/fixture-hashes'
import type { AxbrlContent } from '../electron/main/project/axbrl'

const DATA = resolve(__dirname, '../../data')
const DIXON = join(DATA, 'Instance_Dixon_Global_Private_2025-26_001.xml')
const REBEL = join(DATA, 'Instance_Rebel_Marketplace_India_2025-26.xml')

const content = (over: Partial<AxbrlContent> & { fileName?: string }): AxbrlContent =>
  ({
    manifest: { sources: over.fileName ? { 'workbook-1.xlsx': { fileName: over.fileName, importedAt: '' } } : {} },
    sources: over.sources ?? {},
    imports: over.imports ?? {},
  }) as unknown as AxbrlContent

describe.skipIf(!existsSync(DIXON))('fixture guard on data/', () => {
  const guard = fixtureGuardFrom(DATA)

  it('knows every client file and not the synthetic sample', () => {
    expect(guard.size).toBeGreaterThanOrEqual(5)
    const sample = new Uint8Array(readFileSync(join(DATA, 'sample_financials.xlsx')))
    expect(guard.match(content({ sources: { 'workbook-1.xlsx': sample }, fileName: 'my.xlsx' }))).toBeNull()
  })

  it('matches an imported instance by content, whatever its line ends or name', () => {
    const text = readFileSync(DIXON, 'utf8').replace(/\r?\n/g, '\r\n')
    expect(guard.match(content({ imports: { 'renamed.xml': text } }))).toBe('Instance_Dixon_Global_Private_2025-26_001.xml')
    if (existsSync(REBEL)) expect(guard.match(content({ imports: { 'r.xml': readFileSync(REBEL, 'utf8') } }))).toBe('Instance_Rebel_Marketplace_India_2025-26.xml')
  })

  it('matches a workbook by its bytes or its original file name', () => {
    const dgpl = new Uint8Array(readFileSync(join(DATA, 'BS DGPL Mar-2026-V1.xls')))
    expect(guard.match(content({ sources: { 'workbook-1.xls': dgpl } }))).toBe('BS DGPL Mar-2026-V1.xls')
    expect(guard.match(content({ fileName: 'bs dgpl mar-2026-v1.xls' }))).toBe('bs dgpl mar-2026-v1.xls')
  })

  it('is a no-op without data/ (the packaged app)', () => {
    const none = fixtureGuardFrom(join(DATA, 'no-such-folder'))
    expect(none.size).toBe(0)
    expect(none.match(content({ imports: { 'x.xml': readFileSync(DIXON, 'utf8') } }))).toBeNull()
  })
})
