/**
 * Maps each emitted fact to its line in a generated instance, so the UI can link XML ⟷ facts ⟷ Excel cells.
 * Uses the generator's own deterministic context ids (buildContexts), never text heuristics.
 */
import { buildContexts } from './core/generator.js'

interface EmittedFact {
  key: string
  concept: string
  period: unknown
  dims: unknown[]
}

/** @returns fact key → 1-based line number in `xml` */
export function indexFactLines(xml: string, filing: unknown, emitted: EmittedFact[]): Record<string, number> {
  const { map, keyOf } = buildContexts(filing, emitted) as {
    map: Map<string, { id: string }>
    keyOf: (f: EmittedFact) => string
  }
  const lineOf = new Map<string, number>()
  xml.split('\n').forEach((line, i) => {
    const m = /^\s*<([\w-]+:[\w.-]+) contextRef="([^"]+)"/.exec(line)
    if (m) lineOf.set(`${m[1]}|${m[2]}`, i + 1)
  })
  const out: Record<string, number> = {}
  for (const f of emitted) {
    const ctx = map.get(keyOf(f))?.id
    const line = ctx ? lineOf.get(`${f.concept}|${ctx}`) : undefined
    if (line) out[f.key] = line
  }
  return out
}
