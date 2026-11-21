import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FsWritableDirProbe } from '../electron/main/infra/fs-writable-dir-probe'
import { ProjectsFolder, projectsFolderCandidates } from '../electron/main/services/projects-folder'
import type { ProjectFileLister, WritableDirProbe } from '../electron/main/services/ports'
import type { AxbrlManifest } from '../electron/main/project/axbrl'
import { SavedProjectsService } from '../electron/main/services/saved-projects-service'
import { DirProjectLister } from '../electron/main/infra/dir-project-lister'

const fakeProbe = (writable: string[]): WritableDirProbe & { calls: string[] } => {
  const calls: string[] = []
  return { calls, ensureWritable: (d) => (calls.push(d), writable.includes(d)) }
}

describe('projectsFolderCandidates', () => {
  const j = (...p: string[]) => p.join('/')
  it('puts Program Files first, then Documents, then app data', () => {
    expect(projectsFolderCandidates({ programFiles: 'C:/Program Files', documents: 'C:/Users/a/Documents', userData: 'C:/AppData/XBRL Autopilot' }, j)).toEqual([
      'C:/Program Files/XBRL_Autopilot/Projects',
      'C:/Users/a/Documents/XBRL_Autopilot/Projects',
      'C:/AppData/XBRL Autopilot/Projects',
    ])
  })
  it('skips bases that are unknown (Linux has no Program Files)', () => {
    expect(projectsFolderCandidates({ programFiles: undefined, documents: '/home/a/Documents', userData: '/home/a/.config/x' }, j)).toEqual([
      '/home/a/Documents/XBRL_Autopilot/Projects',
      '/home/a/.config/x/Projects',
    ])
  })
})

describe('ProjectsFolder', () => {
  it('uses Program Files when the installer made it writable', () => {
    const probe = fakeProbe(['pf', 'docs'])
    expect(new ProjectsFolder(['pf', 'docs', 'ud'], probe).dir()).toBe('pf')
  })
  it('falls back to the next writable folder', () => {
    expect(new ProjectsFolder(['pf', 'docs', 'ud'], fakeProbe(['docs'])).dir()).toBe('docs')
  })
  it('returns the last candidate when none is writable (the save dialog then lets the user pick)', () => {
    expect(new ProjectsFolder(['pf', 'docs', 'ud'], fakeProbe([])).dir()).toBe('ud')
  })
  it('resolves once per run', () => {
    const probe = fakeProbe(['docs'])
    const folder = new ProjectsFolder(['pf', 'docs'], probe)
    folder.dir()
    folder.dir()
    expect(probe.calls).toEqual(['pf', 'docs'])
  })
  it('refuses an empty candidate list', () => {
    expect(() => new ProjectsFolder([], fakeProbe([]))).toThrow()
  })
})

describe('FsWritableDirProbe', () => {
  it('creates a missing folder and reports it writable, leaving no probe file', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'xap-pf-')), 'XBRL_Autopilot', 'Projects')
    expect(new FsWritableDirProbe().ensureWritable(dir)).toBe(true)
    expect(existsSync(dir)).toBe(true)
  })
  it('reports false when the path is a file', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'xap-pf-')), 'not-a-dir')
    writeFileSync(file, '')
    expect(new FsWritableDirProbe().ensureWritable(join(file, 'Projects'))).toBe(false)
  })
})

describe('SavedProjectsService', () => {
  const manifest = (name: string, updatedAt: string) =>
    ({ company: { name, cin: 'U1' }, filing: { cy: { start: '2025-04-01', end: '2026-03-31' } }, updatedAt }) as unknown as AxbrlManifest
  it('lists readable projects newest first and skips files that are not projects', async () => {
    const lister: ProjectFileLister = {
      list: async () => [
        { path: join('pf', 'old.axbrl'), manifest: manifest('Old Co', '2026-01-01T00:00:00Z') },
        { path: join('pf', 'junk.axbrl'), manifest: null },
        { path: join('pf', 'new.axbrl'), manifest: manifest('', '2026-05-01T00:00:00Z') },
      ],
    }
    const out = await new SavedProjectsService(() => 'pf', lister).list()
    expect(out.dir).toBe('pf')
    expect(out.projects.map((p) => [p.fileName, p.company])).toEqual([
      ['new.axbrl', '(unnamed company)'],
      ['old.axbrl', 'Old Co'],
    ])
    expect(out.projects[0].fy).toMatch(/2025/)
  })
  it('reads real .axbrl manifests from a folder (missing folder = empty)', async () => {
    expect(await new DirProjectLister().list(join(tmpdir(), 'xap-does-not-exist-' + Date.now()))).toEqual([])
    const dir = mkdtempSync(join(tmpdir(), 'xap-saved-'))
    writeFileSync(join(dir, 'broken.axbrl'), 'not a zip')
    writeFileSync(join(dir, 'notes.txt'), '')
    expect(await new DirProjectLister().list(dir)).toEqual([{ path: join(dir, 'broken.axbrl'), manifest: null }])
  })
})
