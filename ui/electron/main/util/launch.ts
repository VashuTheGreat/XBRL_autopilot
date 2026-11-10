/** Pure helpers for app launch (unit-tested; no Electron imports). */
import type { ProjectSummary } from '@shared/project'

const AXBRL_EXTENSION = '.axbrl'

/** Minimal .env reader: KEY=value lines, optional quotes, # comments. Used only in dev. */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) out[key] = value
  }
  return out
}

/** The .axbrl file Windows passes when the user double-clicks a project (first match wins). */
export function findProjectArg(argv: readonly string[]): string | null {
  return argv.slice(1).find((a) => !a.startsWith('-') && a.toLowerCase().endsWith('.axbrl')) ?? null
}

export function windowTitle(s: ProjectSummary | null): string {
  if (!s) return 'XBRL Autopilot'
  const name = s.company.name || 'Untitled filing'
  const flags = `${s.dirty ? ' •' : ''}${s.readOnlyReason ? ' (read-only)' : ''}`
  return `${name} · ${s.fyLabel} · ${s.reportType}${flags} — XBRL Autopilot`
}

/** "Acme Pvt Ltd_FY 2025-26_Standalone.axbrl" with characters Windows forbids removed. */
export function suggestedFileName(s: ProjectSummary): string {
  const base = `${s.company.name || 'Filing'}_${s.fyLabel}_${s.reportType}`.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim()
  return `${base}${AXBRL_EXTENSION}`
}
