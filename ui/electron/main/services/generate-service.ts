/**
 * GenerateService (docs/14 Step 5): writes the filing instance. Only a clean filing is written: the engine's export
 * gate blocks on any error (GateError), so "Fix first" stays the only way past errors. The instance is kept in the
 * project's output/ folder (NNN.xml) and written to disk next to it, as the MCA tool hand-off does. Electron-free.
 */
import { GateError } from '@xap/engine'
import type { GenerateResult } from '@shared/mandatory'
import { ValidationError } from './errors'
import { nextOutputName, type OutputWriter } from './mca-tool-service'
import type { ProjectAccess } from './ports'

export class GenerateService {
  constructor(
    private readonly projects: ProjectAccess & { summary(): { path: string | null } | null },
    private readonly writer: OutputWriter,
    private readonly today: () => string = () => new Date().toISOString().slice(0, 10),
  ) {}

  async generate(): Promise<GenerateResult> {
    const p = this.projects.project()
    let xml: string
    try {
      xml = (p.session.exportXml({ today: this.today() }) as { xml: string }).xml
    } catch (err) {
      if (err instanceof GateError) {
        const n = (err as unknown as { result: { blocking: number } }).result.blocking
        throw new ValidationError([`${n} validation error${n === 1 ? '' : 's'} must be fixed before the XML is generated.`])
      }
      throw err
    }
    const name = nextOutputName(Object.keys(p.content.outputs))
    p.content.outputs[name] = xml
    p.touch()
    const xmlPath = await this.writer.write(this.projects.summary()?.path ?? null, name, xml)
    return { xmlPath, name }
  }
}
