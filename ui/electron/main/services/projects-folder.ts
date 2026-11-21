/**
 * ProjectsFolder: where filings are saved by default (docs/17 → "Projects folder").
 * Team decision: `<Program Files>\XBRL_Autopilot\Projects`. The installer creates it and lets users write to it;
 * when it isn't writable (dev, no installer, Linux) the next candidate is used, so saving never breaks.
 */
import type { WritableDirProbe } from './ports'

export const PROJECTS_FOLDER_NAME = 'XBRL_Autopilot'
export const PROJECTS_SUBFOLDER = 'Projects'

/** Base directories in priority order; unknown (empty) bases are skipped. */
export interface ProjectsFolderBases {
  programFiles?: string | null
  documents?: string | null
  userData: string
}

export function projectsFolderCandidates(bases: ProjectsFolderBases, join: (...parts: string[]) => string): string[] {
  const roots = [bases.programFiles, bases.documents].filter((b): b is string => !!b)
  return [...roots.map((r) => join(r, PROJECTS_FOLDER_NAME, PROJECTS_SUBFOLDER)), join(bases.userData, PROJECTS_SUBFOLDER)]
}

export class ProjectsFolder {
  private resolved: string | null = null

  constructor(
    private readonly candidates: readonly string[],
    private readonly probe: WritableDirProbe,
  ) {
    if (candidates.length === 0) throw new Error('ProjectsFolder needs at least one candidate directory')
  }

  /** The first writable candidate (created if missing). Resolved once per run. */
  dir(): string {
    if (this.resolved === null) {
      this.resolved = this.candidates.find((c) => this.probe.ensureWritable(c)) ?? this.candidates[this.candidates.length - 1]
    }
    return this.resolved
  }
}
