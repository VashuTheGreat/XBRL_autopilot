/** IPC input validation for the Masters panel (docs/14 Step 9): shapes and sizes only; the service checks meaning. */
import type { FillFromMasterInput, MasterRowRef, SaveMasterInput, SetMasterCellInput, SetMasterItemInput } from '@shared/masters'
import { requireString } from './handle'

/** A master value is a name, a number, an address: never a document. */
const MAX_VALUE = 2_000
const MAX_IDS = 500

const obj = (v: unknown) => (v ?? {}) as Record<string, unknown>

function requireValue(v: unknown): string {
  if (typeof v !== 'string' || v.length > MAX_VALUE) throw new Error('Invalid value')
  return v
}

function requireStrings(v: unknown, name: string): string[] {
  if (!Array.isArray(v) || v.length > MAX_IDS) throw new Error(`Invalid ${name}`)
  return v.map((x) => requireString(x, name))
}

export function requireSetItemInput(input: unknown): SetMasterItemInput {
  const i = obj(input)
  return { concept: requireString(i.concept, 'concept'), value: requireValue(i.value) }
}

export function requireRowRef(input: unknown): MasterRowRef {
  const i = obj(input)
  return { tableId: requireString(i.tableId, 'table'), member: requireString(i.member, 'row') }
}

export function requireSetCellInput(input: unknown): SetMasterCellInput {
  const i = obj(input)
  return { ...requireRowRef(i), concept: requireString(i.concept, 'concept'), value: requireValue(i.value) }
}

export function requireFillInput(input: unknown): FillFromMasterInput {
  const i = obj(input)
  const from = obj(i.from)
  const tableId = requireString(i.tableId, 'table')
  if (from.kind === 'rows') return { tableId, from: { kind: 'rows', tableId: requireString(from.tableId, 'table'), members: requireStrings(from.members, 'row') } }
  if (from.kind === 'library') return { tableId, from: { kind: 'library', ids: requireStrings(from.ids, 'master') } }
  throw new Error('Invalid source')
}

export function requireSaveInput(input: unknown): SaveMasterInput {
  const i = obj(input)
  return typeof i.sectionId === 'string' ? { sectionId: requireString(i.sectionId, 'master') } : requireRowRef(i)
}
