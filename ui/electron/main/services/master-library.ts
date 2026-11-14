/**
 * KeyValueMasterLibrary: the master library (docs/14 Step 9) as one JSON value in the app's key/value store. Electron-free.
 * Records hold values by element local name, so a master saved in a C&I filing fills an Ind AS one.
 */
import { randomUUID } from 'node:crypto'
import type { LibraryRecord } from '@shared/masters'
import type { KeyValueRepository, MasterLibraryStore } from './ports'

const KEY = 'masters.library.v1'

export class KeyValueMasterLibrary implements MasterLibraryStore {
  constructor(
    private readonly repo: KeyValueRepository,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly newId: () => string = randomUUID,
  ) {}

  list(): LibraryRecord[] {
    try {
      const parsed = JSON.parse(this.repo.get(KEY) ?? '[]') as unknown
      return Array.isArray(parsed) ? parsed.filter(isRecord) : []
    } catch {
      return []
    }
  }

  save(record: Pick<LibraryRecord, 'kind' | 'title' | 'values'>): LibraryRecord {
    const all = this.list()
    const same = all.find((r) => r.kind === record.kind && sameValues(r.values, record.values))
    const saved: LibraryRecord = { id: same?.id ?? this.newId(), ...record, savedAt: this.now() }
    this.write([saved, ...all.filter((r) => r.id !== saved.id)])
    return saved
  }

  remove(id: string): void {
    this.write(this.list().filter((r) => r.id !== id))
  }

  private write(records: LibraryRecord[]): void {
    this.repo.set(KEY, JSON.stringify(records))
  }
}

function sameValues(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}

function isRecord(x: unknown): x is LibraryRecord {
  const r = x as LibraryRecord
  return !!r && typeof r.id === 'string' && typeof r.kind === 'string' && typeof r.title === 'string' && !!r.values && typeof r.values === 'object'
}
