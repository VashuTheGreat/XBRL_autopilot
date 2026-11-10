/**
 * App database (%APPDATA%/XBRL Autopilot/app.db) on Node's built-in SQLite (no native module to rebuild).
 * Implements the repositories the services need. Schema changes go through MIGRATIONS (append-only).
 */
import { DatabaseSync } from 'node:sqlite'
import type { RecentProject } from '@shared/project'
import type { KeyValueRepository, RecentProjectsRepository } from '../services/ports'

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

export class AppDatabase implements RecentProjectsRepository, KeyValueRepository {
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

  close(): void {
    this.db.close()
  }
}
