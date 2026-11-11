/**
 * McaToolService (Phase 9): hands the filing to the MCA XBRL Validation Tool v5.1.
 *
 * The tool is GUI-only (docs/01-research), so it is launched, not embedded: the latest XML is written to the project's
 * output/NNN.xml (kept in the .axbrl and on disk next to the project), and the tool is started detached. The user then
 * opens that file in the tool and validates; its error list comes back through ValidationService.importMcaErrors.
 * Electron-free: the process launch, the file write and the tool lookup are ports.
 */
import type { McaLaunchResult } from '@shared/validation'
import { ValidationError } from './errors'
import type { ProjectAccess } from './ports'

export interface ToolLauncher {
  /** starts the program detached (the app does not wait for it) */
  launch(program: string): Promise<void>
}

export interface OutputWriter {
  /** writes `text` as `name` into the output folder of the project (or of the app when unsaved); returns the path */
  write(projectPath: string | null, name: string, text: string): Promise<string>
}

export class McaToolService {
  constructor(
    private readonly projects: ProjectAccess & { summary(): { path: string | null } | null },
    private readonly findTool: () => string | null,
    private readonly writer: OutputWriter,
    private readonly launcher: ToolLauncher,
    private readonly today: () => string = () => new Date().toISOString().slice(0, 10),
  ) {}

  /** The tool's path (settings first, then the known install folders), or null. */
  toolPath(): string | null {
    return this.findTool()
  }

  async launch(): Promise<McaLaunchResult> {
    const tool = this.findTool()
    if (!tool) throw new ValidationError(['The MCA XBRL Validation Tool was not found. Set its path in Settings → MCA Validation Tool.'])
    const p = this.projects.project()
    const { xml, validated } = p.session.exportXml({ allowErrors: true, today: this.today() }) as { xml: string; validated: boolean }
    const name = nextOutputName(Object.keys(p.content.outputs))
    p.content.outputs[name] = xml
    p.touch()
    const xmlPath = await this.writer.write(this.projects.summary()?.path ?? null, name, xml)
    await this.launcher.launch(tool)
    return { xmlPath, toolPath: tool, validated }
  }
}

/** output/001.xml, 002.xml, … (the next free number). */
export function nextOutputName(existing: string[]): string {
  const max = existing.reduce((m, k) => Math.max(m, Number(/^(\d+)\.xml$/.exec(k)?.[1] ?? 0)), 0)
  return `${String(max + 1).padStart(3, '0')}.xml`
}
