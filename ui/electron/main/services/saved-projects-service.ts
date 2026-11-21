/**
 * SavedProjectsService: the filings saved in the projects folder (docs/17), for the start screen.
 * Electron-free: the folder and the file listing come in through small ports.
 */
import { basename } from 'node:path'
import { fyLabel } from '@xap/engine/basics'
import type { SavedProject, SavedProjectsListing } from '@shared/project'
import type { ProjectFileLister } from './ports'

export class SavedProjectsService {
  constructor(
    private readonly dir: () => string,
    private readonly lister: ProjectFileLister,
  ) {}

  /** Readable projects in the folder, newest first; files that aren't projects are skipped. */
  async list(): Promise<SavedProjectsListing> {
    const dir = this.dir()
    const projects: SavedProject[] = []
    for (const { path, manifest } of await this.lister.list(dir)) {
      if (!manifest) continue
      projects.push({
        path,
        fileName: basename(path),
        company: manifest.company.name || '(unnamed company)',
        cin: manifest.company.cin,
        fy: fyLabel(manifest.filing.cy),
        updatedAt: manifest.updatedAt,
      })
    }
    projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return { dir, projects }
  }
}
