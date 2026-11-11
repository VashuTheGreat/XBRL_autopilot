/**
 * Rebel Marketplace India (Ind AS 2017, FY 2025-26, standalone, Webtel v32.5): an offline fixture, NOT a golden.
 * MCA acceptance of this exact instance is not shown (the screenshot the team shared is Rebel Foods, consolidated),
 * so its current ERRORs are pinned as known: a change in them is a rule change to look at, not a silent drift.
 * Triage open: ML-40 (KMP qualification), SR-L1097-1 (PPE revaluation flag), SR-L6487-2 (auditor vs director signing
 * date). Real client data: it stays in this process (docs/12-reference-data.md).
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assembleAuthority, Authority, importXbrl, Session } from '../src/index'

const KB = (f: string) => new URL(`../../knowledge_base/${f}`, import.meta.url)
const REBEL = new URL('../../data/Instance_Rebel_Marketplace_India_2025-26.xml', import.meta.url)
const files = [REBEL, KB('ind_as_engine_authority.json'), KB('ind_as_engine_rules.json')]
const ready = files.every((u) => existsSync(u))
const json = (u: URL) => JSON.parse(readFileSync(u, 'utf8'))

type Issue = { severity: string; ruleId?: string; code?: string }

describe.skipIf(!ready)('Rebel Marketplace (Ind AS): known ERRORs, pinned', () => {
  it('imports every fact and gives exactly the 7 known ERRORs', () => {
    const A = new Authority(assembleAuthority(json(files[1]!), json(files[2]!)))
    const { filing } = importXbrl(A, readFileSync(REBEL, 'utf8'), { fileName: 'rebel.xml' }) as { filing: { facts: Map<string, unknown> } }
    expect(filing.facts.size).toBe(1152)
    const issues = (new Session(A, filing as never).validate({ today: '2026-11-11' }) as { issues: Issue[] }).issues
    const errors: Record<string, number> = {}
    for (const i of issues.filter((x) => x.severity === 'ERROR')) errors[i.ruleId ?? i.code ?? '?'] = (errors[i.ruleId ?? i.code ?? '?'] ?? 0) + 1
    expect(errors).toEqual({ 'ML-40': 4, 'SR-L1097-1': 2, 'SR-L6487-2': 1 })
  })
})
