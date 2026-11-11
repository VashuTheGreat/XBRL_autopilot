/**
 * ADR-0013 decision 1: ELR groups (Statements / Notes / Disclosures) come from the ELR title, not the code. C&I's code
 * ranges misread Ind AS (210000 is its P&L, 400xxx are notes, 7xxxxx the disclosures), which switched off Ind AS
 * statement ↔ note derivation (derived.js statementNoteLinks), Session.noteLink and the disclosure carry-forward.
 */
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { disclosureTab } from '../src/core/carry-forward.js'
import { statementNoteLinks } from '../src/core/derived.js'
import { assembleAuthority, Authority, importXbrl, Session } from '../src/index'

const KB = (f: string) => new URL(`../../knowledge_base/${f}`, import.meta.url)
const DIXON = new URL('../../data/Instance_Dixon_Global_Private_2025-26_001.xml', import.meta.url)
const json = (u: URL) => JSON.parse(readFileSync(u, 'utf8'))
const load = (kb: string) => new Authority(assembleAuthority(json(KB(`${kb}_engine_authority.json`)), json(KB(`${kb}_engine_rules.json`))))

type Elr = { uri: string; code: string; title: string; group: string }
const groupOf = (A: Authority, code: string) => new Set((A.elrs as Elr[]).filter((e) => e.code === code).map((e) => e.group))
const uriOf = (A: Authority, code: string) => (A.elrs as Elr[]).find((e) => e.code === code)!.uri

describe('ELR groups by title', () => {
  it('C&I keeps its groups (its codes happen to follow the same scheme)', () => {
    const A = load('ci')
    const count = (g: string) => (A.elrs as Elr[]).filter((e) => e.group === g).length
    expect([count('Statements'), count('Notes'), count('Disclosures')]).toEqual([4, 38, 5])
    expect(groupOf(A, '400100')).toEqual(new Set(['Disclosures'])) // general information
  })

  it('Ind AS: P&L, cash flow and changes in equity are statements, 400xxx notes, 7xxxxx disclosures', () => {
    const A = load('ind_as')
    for (const code of ['110000', '210000', '320000', '400200']) expect(groupOf(A, code)).toEqual(new Set(['Statements']))
    for (const code of ['400100', '400600', '401100', '500100', '700100']) expect(groupOf(A, code)).toEqual(new Set(['Notes']))
    for (const code of ['700300', '700400', '700500', '700600']) expect(groupOf(A, code)).toEqual(new Set(['Disclosures']))
    expect(disclosureTab(A, uriOf(A, '700300'))).toBe(true)
    expect(disclosureTab(A, uriOf(A, '400600'))).toBe(false)
  })

  it('Ind AS statement figures are linked to their notes (PPE, share capital, receivables, P&L lines)', () => {
    const links = statementNoteLinks(load('ind_as')) as Map<string, { kind: string; tableId?: string; elrUri: string }>
    expect(links.size).toBeGreaterThanOrEqual(35)
    expect(links.get('ind-as:PropertyPlantAndEquipment')).toMatchObject({ kind: 'sum', tableId: '400600:DisclosureOfPropertyPlantAndEquipmentTable' })
    expect(links.get('ind-as:EquityShareCapital')).toMatchObject({ kind: 'sum', tableId: '400100:DisclosureOfClassesOfEquityShareCapitalTable' })
    expect(links.get('ind-as:TradeReceivablesCurrent')).toMatchObject({ kind: 'sum', tableId: '401100:SubclassificationOfTradeReceivablesTable' })
    expect(links.get('ind-as:RevenueFromOperations')?.kind).toBe('row')
  })

  it.skipIf(!existsSync(DIXON))('Dixon (MCA-accepted): statements agree with their notes, nothing is re-derived on opening', () => {
    const A = load('ind_as')
    const { filing } = importXbrl(A, readFileSync(DIXON, 'utf8'), { fileName: 'dixon.xml' }) as unknown as { filing: never }
    const S = new Session(A, filing) as unknown as { statementNoteDifferences(): unknown[]; refreshDerivedStatements(): unknown[] }
    expect(S.statementNoteDifferences()).toEqual([])
    expect(S.refreshDerivedStatements()).toEqual([])
  })
})
