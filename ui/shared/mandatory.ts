/** Mandatory non-numeric items, required tables, key answers and Generate (docs/14 Step 5). */
import type { Scope } from './editor'

/** A text / date / Yes-No / list item the MCA rules require now and that is still empty. */
export interface MandatoryItemView {
  concept: string
  label: string
  /** engine data type: string, textBlock, date, boolean, enum, token … (picks the input) */
  dataType: string
  scope: Scope
  /** the statement / note where it is entered; the dialog groups by it */
  elrUri: string
  elrCode: string
  elrTitle: string
  rules: string[]
  reasons: string[]
  /** required because of another answer ("mandatory if Yes") */
  conditional: boolean
  enumerations: string[] | null
}

/** A table an answer makes mandatory that has no values yet ("This table is mandatory if … is Yes"). */
export interface RequiredTableView {
  tableId: string
  title: string
  elrUri: string
  elrCode: string
  elrTitle: string
  scope: Scope
  ruleId: string
  reason: string
}

export interface MandatoryView {
  items: MandatoryItemView[]
  tables: RequiredTableView[]
}

/** One Yes/No answer Generate asks to confirm, and what it decides. */
export interface KeyAnswerView {
  concept: string
  label: string
  elrUri: string | null
  /** CY answer; null = not answered */
  value: boolean | null
  /** Yes / No: the answer under which `decides` are required */
  requiredWhen: boolean
  decides: string[]
  rules: string[]
}

/** Writes one mandatory item (CY or PY) as the user typed it: "true" / "false", a date (YYYY-MM-DD), a text. */
export interface SetMandatoryInput {
  concept: string
  scope: Scope
  value: string
}

export interface GenerateResult {
  /** where the instance was written (also kept in the project's output/ folder) */
  xmlPath: string
  name: string
}

/** The statements of a list, in first-seen order, each with its items: the dialog's groups. */
export function groupByStatement<T extends { elrUri: string; elrCode: string; elrTitle: string }>(rows: T[]): { elrUri: string; title: string; rows: T[] }[] {
  const groups = new Map<string, { elrUri: string; title: string; rows: T[] }>()
  for (const r of rows) {
    const g = groups.get(r.elrUri) ?? groups.set(r.elrUri, { elrUri: r.elrUri, title: `[${r.elrCode}] ${r.elrTitle}`, rows: [] }).get(r.elrUri)!
    g.rows.push(r)
  }
  return [...groups.values()]
}

export type MandatoryInputKind = 'yesNo' | 'date' | 'list' | 'textBlock' | 'text'

/** The inline input for an item's data type (Yes/No buttons, a date picker, a list, a text area, a text field). */
export function inputKind(item: Pick<MandatoryItemView, 'dataType' | 'enumerations'>): MandatoryInputKind {
  if (item.dataType === 'boolean') return 'yesNo'
  if (item.dataType === 'date') return 'date'
  if (item.enumerations?.length) return 'list'
  return item.dataType === 'textBlock' ? 'textBlock' : 'text'
}

/** What still stands between the filing and Generate, in the order the dialog shows it. */
export interface GenerateReadiness {
  ready: boolean
  /** key questions not answered yet */
  unanswered: string[]
  /** the user has not confirmed the key answers */
  unconfirmed: boolean
  /** validation errors (blocking: "Fix first") */
  errors: number
  /** mandatory text / date / Yes-No items and required tables still empty (also errors of the gate) */
  pending: number
}

export function generateReadiness(input: { keyAnswers: KeyAnswerView[]; confirmed: boolean; errors: number; mandatory: MandatoryView | null }): GenerateReadiness {
  const unanswered = input.keyAnswers.filter((k) => k.value === null).map((k) => k.label)
  const pending = (input.mandatory?.items.length ?? 0) + (input.mandatory?.tables.length ?? 0)
  const unconfirmed = input.keyAnswers.length > 0 && !input.confirmed
  return { ready: !unanswered.length && !unconfirmed && input.errors === 0, unanswered, unconfirmed, errors: input.errors, pending }
}
