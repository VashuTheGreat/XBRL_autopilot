/**
 * App database (%APPDATA%/XBRL Autopilot/app.db) on Node's built-in SQLite (no native module to rebuild).
 * Implements the repositories the services need. Schema changes go through MIGRATIONS (append-only).
 */
import { DatabaseSync } from 'node:sqlite'
import type { RecentProject } from '@shared/project'
import type { TaxonomyId } from '@xap/engine/basics'
import type { KeyValueRepository, MappingMemoryItem, MappingMemoryRepository, RecentProjectsRepository } from '../services/ports'

/** "  Trade  Receivables " → "trade receivables" (the memory key; the sidecar applies its full normalisation). */
export const memoryLabel = (label: string): string => label.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 500)

const MIGRATIONS: string[] = [
  `CREATE TABLE recent_projects (
     path TEXT PRIMARY KEY, company TEXT NOT NULL, cin TEXT NOT NULL, fy TEXT NOT NULL, opened_at TEXT NOT NULL);
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE mapping_memory (
     taxonomy_id TEXT NOT NULL, norm_label TEXT NOT NULL, sheet_kind TEXT NOT NULL DEFAULT '',
     concept TEXT NOT NULL, period_hint TEXT, dims_json TEXT NOT NULL DEFAULT '[]',
     approvals INTEGER NOT NULL DEFAULT 1, last_used TEXT NOT NULL,
     PRIMARY KEY (taxonomy_id, norm_label, sheet_kind, concept, dims_json));`,
]

export class AppDatabase implements RecentProjectsRepository, KeyValueRepository, MappingMemoryRepository {
  private readonly db: DatabaseSync

  /** @param file path to app.db, or ':memory:' for tests */
  constructor(file: string) {
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    this.migrate()
  }

  private migrate(): void {
    const version = Number((this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.db.exec('BEGIN')
      try {
        this.db.exec(MIGRATIONS[v]!)
        this.db.exec(`PRAGMA user_version = ${v + 1}`)
        this.db.exec('COMMIT')
      } catch (err) {
        this.db.exec('ROLLBACK')
        throw err
      }
    }
  }

  // ---- RecentProjectsRepository
  touch(e: Omit<RecentProject, 'exists'>): void {
    this.db
      .prepare(
        `INSERT INTO recent_projects (path, company, cin, fy, opened_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET company = excluded.company, cin = excluded.cin, fy = excluded.fy, opened_at = excluded.opened_at`,
      )
      .run(e.path, e.company, e.cin, e.fy, e.openedAt)
  }

  list(limit = 15): Omit<RecentProject, 'exists'>[] {
    return (
      this.db
        .prepare('SELECT path, company, cin, fy, opened_at AS openedAt FROM recent_projects ORDER BY opened_at DESC LIMIT ?')
        .all(limit) as unknown as Omit<RecentProject, 'exists'>[]
    ).map((r) => ({ ...r }))
  }

  remove(path: string): void {
    this.db.prepare('DELETE FROM recent_projects WHERE path = ?').run(path)
  }

  // ---- KeyValueRepository
  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  set(key: string, value: string): void {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  // ---- MappingMemoryRepository (labels are stored lower-case with single spaces; the sidecar normalises further)
  recall(taxonomy: TaxonomyId): MappingMemoryItem[] {
    return (
      this.db
        .prepare('SELECT norm_label AS label, concept, approvals FROM mapping_memory WHERE taxonomy_id = ? ORDER BY last_used DESC LIMIT 20000')
        .all(taxonomy) as unknown as MappingMemoryItem[]
    ).map((r) => ({ label: r.label, concept: r.concept, approvals: Number(r.approvals) }))
  }

  remember(taxonomy: TaxonomyId, label: string, concept: string): void {
    const norm = memoryLabel(label)
    if (!norm) return
    this.db
      .prepare(
        `INSERT INTO mapping_memory (taxonomy_id, norm_label, concept, last_used) VALUES (?, ?, ?, ?)
         ON CONFLICT(taxonomy_id, norm_label, sheet_kind, concept, dims_json)
         DO UPDATE SET approvals = approvals + 1, last_used = excluded.last_used`,
      )
      .run(taxonomy, norm, concept, new Date().toISOString())
  }

  close(): void {
    this.db.close()
  }
}
