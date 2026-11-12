/** Node adapters for McaToolService: find the MCA tool, write output/NNN.xml, start the tool detached. */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { OutputWriter, ToolLauncher } from '../services/mca-tool-service'

export const MCA_TOOL_EXE = /^MCA_XBRL_Valiation_Tool_V[\d.]+\.exe$/i

/** The first MCA tool exe under `roots`, searched two folders deep (the zip unpacks into a dated folder). */
export function findMcaTool(roots: string[], depth = 2): string | null {
  for (const root of roots) {
    if (!root || !existsSync(root)) continue
    const hit = search(root, depth)
    if (hit) return hit
  }
  return null
}

function search(dir: string, depth: number): string | null {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return null
  }
  const exe = names.find((n) => MCA_TOOL_EXE.test(n))
  if (exe) return join(dir, exe)
  if (depth <= 0) return null
  for (const n of names) {
    const p = join(dir, n)
    try {
      if (statSync(p).isDirectory()) {
        const hit = search(p, depth - 1)
        if (hit) return hit
      }
    } catch {
      // unreadable entry: skip
    }
  }
  return null
}

/** output/ next to the saved project, else under the app's data folder. */
export class FileOutputWriter implements OutputWriter {
  constructor(private readonly fallbackDir: string) {}

  async write(projectPath: string | null, name: string, text: string): Promise<string> {
    const dir = projectPath ? join(dirname(projectPath), 'output') : this.fallbackDir
    await mkdir(dir, { recursive: true })
    const file = join(dir, name)
    await writeFile(file, text, 'utf8')
    return file
  }
}

export class DetachedLauncher implements ToolLauncher {
  async launch(program: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(program, [], { cwd: dirname(program), detached: true, stdio: 'ignore', windowsHide: false })
      child.once('error', reject)
      child.once('spawn', () => {
        child.unref()
        resolve()
      })
    })
  }
}
