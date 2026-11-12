/**
 * Phase 9 acceptance (ADR-0011): the MCA-accepted Dixon instance (Ind AS, FY 2025-26) gives 0 ERRORs under the Ind AS
 * business rules built from the MCA workbook. Every exception is a curation entry
 * (src/services/engine_rules/curation/ind_as/divergences.json) with the rule text, the Dixon fact and why MCA accepted
 * it — never a silent skip. Real client data: it stays in this process (docs/12-reference-data.md).
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assembleAuthority, Authority, importXbrl, Session } from '../src/index'

const KB = (f: string) => new URL(`../../knowledge_base/${f}`, import.meta.url)
const DIXON = new URL('../../data/Instance_Dixon_Global_Private_2025-26_001.xml', import.meta.url)
const TAXONOMY = KB('ind_as_engine_authority.json')
const RULES = KB('ind_as_engine_rules.json')
const ready = [DIXON, TAXONOMY, RULES].every((u) => existsSync(u))
const json = (u: URL) => JSON.parse(readFileSync(u, 'utf8'))

type Issue = { severity: string; ruleId?: string; code?: string; message: string }

describe.skipIf(!ready)('Ind AS business rules on Dixon (MCA-accepted)', () => {
  const A = ready ? new Authority(assembleAuthority(json(TAXONOMY), json(RULES))) : (null as never)
  const validate = () => {
    const { filing } = importXbrl(A, readFileSync(DIXON, 'utf8'), { fileName: 'dixon.xml' })
    return new Session(A, filing as never).validate({ today: '2026-11-10' }) as { issues: Issue[]; results?: unknown }
  }

  it('loads the Ind AS rules with their generic rules found by handler', () => {
    expect(A.rules.rules.length).toBeGreaterThan(1300)
    const handlers = A.rules.rules.filter((r: { family: string }) => r.family === 'generic').map((r: { id: string; ast?: { handler?: string } }) => `${r.id}:${r.ast?.handler ?? '-'}`)
    expect(handlers).toContain('GR-5:cy-py-pairing')
    expect(handlers).toContain('GR-6:opening-closing-roll-forward')
    expect(handlers).toContain('GR-11:elr-not-for-prior-year')
    expect(handlers).toContain('GR-16:fta-opening-balance-sheet')
  })

  it('gives 0 ERRORs (every MCA-accepted exception is curated with evidence)', () => {
    const errors = validate().issues.filter((i) => i.severity === 'ERROR')
    const byRule = new Map<string, string[]>()
    for (const e of errors) {
      const k = e.ruleId || e.code || '?'
      ;(byRule.get(k) || byRule.set(k, []).get(k)!).push(e.message)
    }
    const report = [...byRule].sort((a, b) => b[1].length - a[1].length).map(([k, m]) => {
      const def = A.rules.rules.find((r: { id: string }) => r.id === k) as { implementation?: string; text?: string } | undefined
      return `${k} ×${m.length} [${def?.implementation ?? ''}] ${def?.text?.slice(0, 160) ?? ''}\n    ${m.slice(0, 3).map((x) => x.slice(0, 300)).join('\n    ')}`
    })
    expect(report.join('\n')).toBe('')
  })

  it('reports every curated exception as a warning with its evidence (no silent skip)', () => {
    const curated = JSON.parse(readFileSync(new URL('../../src/services/engine_rules/curation/ind_as/divergences.json', import.meta.url), 'utf8')).rules as { ruleId: string }[]
    const warned = new Set(validate().issues.filter((i) => i.severity === 'WARNING' && /not blocking: MCA-accepted Dixon/.test(i.message)).map((i) => i.ruleId))
    expect([...warned].sort()).toEqual(curated.map((d) => d.ruleId).sort())
  })
})
