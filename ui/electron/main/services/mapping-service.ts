/**
 * MappingService: Excel cell ↔ taxonomy fact. Tagging a cell writes the cell's value into the engine filing;
 * untagging removes it. Invariants: one cell → one fact, one fact ← one cell.
 * The engine stays the source of truth for values; mapping.json records where they came from.
 */
import { randomUUID } from 'node:crypto'
import { decimal as Dec, nondimAllowed } from '@xap/engine'
import type { CellInfo, ColumnPeriod, MappingEntry, MappingStatus, MappingView, Scope, TagCellInput } from '@shared/editor'
import { cellKey, sameCell, type CellModel, type CellRef } from '@shared/workbook'
import { withSign } from '../mapping/amounts'
import { cellAmount } from '../mapping/cell-amount'
import type { ColumnPeriodService } from './column-period-service'
import { ValidationError } from './errors'
import type { ProjectAccess, ProjectHandle } from './ports'
import type { SourceService } from './source-service'

type Fact = { key: string; value: string | null; nil?: boolean }

export class MappingService {
  constructor(
    private readonly projects: ProjectAccess,
    private readonly sources: SourceService,
    private readonly columns: ColumnPeriodService,
    private readonly newId: () => string = randomUUID,
  ) {}

  list(): MappingView[] {
    const p = this.projects.project()
    return this.entries(p).map((e) => this.view(p, e))
  }

  async tag(input: TagCellInput): Promise<MappingView> {
    const p = this.projects.project()
    const A = p.authority.authority
    const concept = A.concept(input.concept) as { kind?: string } | null
    if (!concept || !A.isReportable(input.concept)) throw new ValidationError([`${input.concept} is not a reportable taxonomy element.`])
    if (!nondimAllowed(A, input.concept)) {
      throw new ValidationError([`“${A.label(input.concept)}” is reported inside a table (with axes). Tagging table cells comes in a later version; pick a statement-level element.`])
    }

    const { cell } = await this.sources.cell(input.cell)
    if (!cell || cell.v === null || cell.v === '') throw new ValidationError(['The selected cell is empty. Select the cell that holds the amount.'])

    const scope = input.scope ?? scopeOrExplain(await this.columns.of(input.cell))
    if (scope === 'PY' && !p.periods().py) throw new ValidationError(['This is the company’s first financial year: there are no previous-year figures.'])

    const sign = input.sign ?? 1
    const display = this.displayValue(p, input.concept, input.cell, cell, sign)
    this.applyFact(p, input.concept, scope, display)

    // one cell → one fact and one fact ← one cell: drop older mappings that clash
    const entries = this.entries(p)
    const clash = (e: MappingEntry) =>
      sameCell(e.cell, input.cell) || (e.fact.concept === input.concept && e.fact.scope === scope && e.fact.dims.length === 0)
    for (const old of entries.filter(clash)) {
      if (sameCell(old.cell, input.cell) && (old.fact.concept !== input.concept || old.fact.scope !== scope)) this.removeFact(p, old)
    }
    const entry: MappingEntry = {
      id: this.newId(),
      cell: { ...input.cell },
      label: await this.sources.rowLabel(input.cell),
      fact: { concept: input.concept, scope, dims: [] },
      sign,
      origin: 'manual',
      confidence: null,
      status: 'approved', // a person chose it
    }
    this.setEntries(p, [...entries.filter((e) => !clash(e)), entry])
    p.touch()
    return this.view(p, entry)
  }

  untag(id: string): void {
    const p = this.projects.project()
    const entry = this.find(p, id)
    this.removeFact(p, entry)
    this.setEntries(p, this.entries(p).filter((e) => e.id !== id))
    p.touch()
  }

  async setScope(id: string, scope: Scope): Promise<MappingView> {
    const p = this.projects.project()
    const e = this.find(p, id)
    if (e.fact.scope === scope) return this.view(p, e)
    this.untag(id)
    const view = await this.tag({ cell: e.cell, concept: e.fact.concept, scope, sign: e.sign })
    // correcting a cell's period corrects its column: later cells of the column follow
    await this.columns.set(e.cell, scope)
    return view
  }

  /** What the inspector shows for a cell: its amount at the statement's precision and its column's period. */
  async cellInfo(ref: CellRef): Promise<CellInfo> {
    const p = this.projects.project()
    const { cell } = await this.sources.cell(ref)
    const amount = cell ? cellAmount(cell, this.meta(p).displayPlaces) : null
    return { cell: { ...ref }, amount, column: await this.columns.of(ref) }
  }

  setStatus(id: string, status: MappingStatus): MappingView {
    const p = this.projects.project()
    const e = this.find(p, id)
    e.status = status
    p.touch()
    return this.view(p, e)
  }

  /** cellKey → mapping, for the Excel overlay and the inspector. */
  byCell(): Map<string, MappingView> {
    return new Map(this.list().map((m) => [cellKey(m.cell), m]))
  }

  // ------------------------------------------------------------------ internals
  private entries(p: ProjectHandle): MappingEntry[] {
    return p.content.mapping.entries as MappingEntry[]
  }

  private setEntries(p: ProjectHandle, entries: MappingEntry[]): void {
    p.content.mapping.entries = entries
  }

  private find(p: ProjectHandle, id: string): MappingEntry {
    const e = this.entries(p).find((x) => x.id === id)
    if (!e) throw new ValidationError(['That tag no longer exists.'])
    return e
  }

  private fact(p: ProjectHandle, e: MappingEntry): Fact | null {
    return (p.session.getValue(e.fact.concept, e.fact.scope, e.fact.dims) as Fact | null) ?? null
  }

  private view(p: ProjectHandle, e: MappingEntry): MappingView {
    const fact = this.fact(p, e)
    return {
      ...e,
      conceptLabel: p.authority.authority.label(e.fact.concept),
      factKey: fact?.key ?? null,
      value: fact ? String(p.session.displayOf(fact)) : null,
    }
  }

  private meta(p: ProjectHandle): { displayPlaces: number; level: string } {
    const m = p.session.filing.meta as { displayPlaces?: number; level: string }
    return { displayPlaces: Number(m.displayPlaces) || 0, level: m.level }
  }

  private displayValue(p: ProjectHandle, concept: string, ref: CellRef, cell: CellModel, sign: 1 | -1): string {
    const A = p.authority.authority
    const raw = cell.v as string | number | boolean
    if (A.isNumeric(concept)) {
      const { displayPlaces, level } = this.meta(p)
      const amount = cellAmount(cell, displayPlaces)
      if (amount === null) throw new ValidationError([`“${String(raw)}” is not a number, but ${A.label(concept)} needs an amount.`])
      // never round away a digit the statement shows: MCA wants the actual figures
      if (A.dataType(concept) === 'monetary' && fractionDigits(amount.value) > displayPlaces) {
        throw new ValidationError([
          `${ref.sheet}!${ref.ref} shows ${amount.value} (${fractionDigits(amount.value)} decimal places), but this filing takes amounts in ${level === 'Actual' ? 'rupees' : level} with ${displayPlaces} decimal place${displayPlaces === 1 ? '' : 's'} as presented. Nothing was tagged: a digit would be lost.`,
        ])
      }
      return withSign(amount.value, sign)
    }
    if (A.dataType(concept) === 'boolean') {
      const t = String(raw).trim().toLowerCase()
      if (['yes', 'true', 'y'].includes(t)) return 'true'
      if (['no', 'false', 'n'].includes(t)) return 'false'
      throw new ValidationError([`${A.label(concept)} needs Yes or No.`])
    }
    return String(raw).trim()
  }

  private applyFact(p: ProjectHandle, concept: string, scope: Scope, display: string): void {
    try {
      p.session.setValue(concept, scope, display, { strict: true })
    } catch (err) {
      throw new ValidationError([err instanceof Error ? err.message : String(err)])
    }
  }

  private removeFact(p: ProjectHandle, e: MappingEntry): void {
    const fact = this.fact(p, e)
    if (fact) p.session.filing.removeFact(fact.key)
  }
}

/** The column's period, or a ValidationError that says why it is unknown and what to do. */
function scopeOrExplain(col: ColumnPeriod): Scope {
  if (col.scope) return col.scope
  if (col.basis === 'outside') {
    throw new ValidationError([
      `Column ${col.column} isn’t part of this filing: its ${col.reason}. If it does hold this filing’s figures, set the column to CY or PY in the strip under the grid.`,
    ])
  }
  throw new ValidationError([`Could not tell whether column ${col.column} is the current or previous year. Set the column to CY or PY in the strip under the grid.`])
}

const fractionDigits = (v: string) => Dec.fractionDigits(Dec.parse(v))
