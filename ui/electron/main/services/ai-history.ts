/**
 * ai/history.jsonl (docs/03, docs/07): the project's append-only audit trail of the AI fix agent. One JSON object
 * per line: what was sent (the exact payload, already without identity data), what came back, and who accepted or
 * rejected which patch, when. It travels with the .axbrl file; nothing else keeps it.
 */
import type { AiHistoryEntry } from '@shared/ai'
import type { Clock, ProjectHandle } from './ports'

export class AiHistory {
  constructor(
    private readonly clock: Clock,
    private readonly who: () => string,
  ) {}

  append(p: ProjectHandle, entry: Omit<AiHistoryEntry, 'at' | 'by'>): AiHistoryEntry {
    const line: AiHistoryEntry = { at: this.clock.now().toISOString(), by: this.who(), ...entry } as AiHistoryEntry
    const cur = p.content.aiHistory
    p.content.aiHistory = `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}${JSON.stringify(line)}\n`
    p.touch()
    return line
  }

  /** The newest `limit` entries, newest last; unreadable lines are skipped. */
  read(p: ProjectHandle, limit = 200): AiHistoryEntry[] {
    const out: AiHistoryEntry[] = []
    for (const line of p.content.aiHistory.split('\n')) {
      if (!line.trim()) continue
      try {
        out.push(JSON.parse(line) as AiHistoryEntry)
      } catch {
        // a hand-edited or truncated line: keep the rest readable
      }
    }
    return out.slice(-limit)
  }
}
