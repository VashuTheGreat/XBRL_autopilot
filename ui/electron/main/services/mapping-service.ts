/**
 * MappingService: Excel cell (or a one-column range, summed) ↔ taxonomy fact. Tagging writes the value into the engine
 * filing; untagging removes it. Invariants: one cell → one fact, one fact ← one cell (ranges count by their cells).
 * The engine stays the source of truth for values; mapping.json records where they came from.
 */
import { randomUUID } from 'node:crypto'
import { decimal as Dec, nondimAllowed, SCALE_POWERS, SHARE_CAPITAL } from '@xap/engine'
import type { CellAmount, CellInfo, ColumnPeriod, MappingEntry, MappingStatus, MappingView, Scope, TagCellInput } from '@shared/editor'
import { overlaps, rangeCells, rangeOf, sameCell, type CellModel, type CellRef } from '@shared/workbook'
import { withSign } from '../mapping/amounts'
import { rangeAmount, type AmountPrecision } from '../mapping/cell-amount'
import type { ColumnPeriodService } from './column-period-service'
import { ValidationError } from './errors'
import type { ProjectAccess, ProjectHandle } from './ports'
import type { SourceService } from './source-service'

type Fact = { key: string; value: string | null; nil?: boolean }

interface FilingPrecision {
  level: string
  /** statement figures' places ("decimal places as presented") */
  statementPlaces: number
  /** the finest places any amount may have (paise) */
  displayPlaces: number
}

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
    const range = rangeOf(input.cell.ref)
    if (range && range.c1 !== range.c2) throw new ValidationError(['Select cells in one column (one year) to tag their sum.'])
    const isRange = !!range && range.r1 !== range.r2
    if (isRange && !A.isNumeric(input.concept)) throw new ValidationError([`Only amounts can be summed: “${A.label(input.concept)}” is not a number.`])

    const { cells } = await this.sources.cell(input.cell)
    if (cells.every((c) => !c || c.v === null || c.v === '')) {
      throw new ValidationError([isRange ? 'The selected cells are empty.' : 'The selected cell is empty. Select the cell that holds the amount.'])
    }

    const scope = input.scope ?? scopeOrExplain(await this.columns.of(input.cell))
    if (scope === 'PY' && !p.periods().py) throw new ValidationError(['This is the company’s first financial year: there are no previous-year figures.'])

    const sign = input.sign ?? 1
    const display = this.displayValue(p, input.concept, input.cell, cells, sign)

    this.applyFact(p, input.concept, scope, display)

    // one cell → one fact and one fact ← one cell: older mappings that clash are replaced
    const entries = this.entries(p)
    const clash = (e: MappingEntry) =>
      overlaps(e.cell, input.cell) || (e.fact.concept === input.concept && e.fact.scope === scope && e.fact.dims.length === 0)
    for (const old of entries.filter(clash)) {
      if (old.fact.concept !== input.concept || old.fact.scope !== scope) this.removeFact(p, old)
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

  /**
   * Re-pulls every tagged figure from Excel at the filing's current precision (after "decimal places as presented"
   * changed). Returns the problems of tags that could not be re-applied; those tags keep their previous value.
   */
  async reapply(): Promise<string[]> {
    const p = this.projects.project()
    const problems: string[] = []
    for (const e of this.entries(p)) {
      try {
        const { cells } = await this.sources.cell(e.cell)
        this.applyFact(p, e.fact.concept, e.fact.scope, this.displayValue(p, e.fact.concept, e.cell, cells, e.sign))
      } catch (err) {
        problems.push(`${e.cell.sheet}!${e.cell.ref}: ${err instanceof ValidationError ? err.problems.join(' ') : String(err)}`)
      }
    }
    p.touch()
    return problems
  }

  /** What the inspector shows for a cell or range: its amount as it goes into the filing and its column's period. */
  async cellInfo(ref: CellRef): Promise<CellInfo> {
    const p = this.projects.project()
    const { cells } = await this.sources.cell(ref)
    const tagged = this.entries(p).find((e) => sameCell(e.cell, ref))
    const amount = rangeAmount(cells, this.precisionFor(p, tagged?.fact.concept ?? null))
    return { cell: { ...ref }, amount, column: await this.columns.of(ref) }
  }

  setStatus(id: string, status: MappingStatus): MappingView {
    const p = this.projects.project()
    const e = this.find(p, id)
    e.status = status
    p.touch()
    return this.view(p, e)
  }

  /** A1 of every cell a mapping covers → mapping, for the Excel overlay and the inspector. */
  byCell(): Map<string, MappingView> {
    const out = new Map<string, MappingView>()
    for (const m of this.list()) for (const a1 of rangeCells(m.cell.ref)) out.set(`${m.cell.workbook}|${m.cell.sheet}|${a1}`, m)
    return out
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

  private filingPrecision(p: ProjectHandle): FilingPrecision {
    const m = p.session.filing.meta as { displayPlaces?: number; statementPlaces?: number | null; level: string }
    const displayPlaces = Number(m.displayPlaces) || 0
    return { level: m.level, displayPlaces, statementPlaces: Math.min(Number(m.statementPlaces ?? displayPlaces) || 0, displayPlaces) }
  }

  /** Share capital is filed at its actual value (to the rupee, engine gate SHARE_CAPITAL); other amounts as presented. */
  private precisionFor(p: ProjectHandle, concept: string | null): AmountPrecision {
    const { level, statementPlaces } = this.filingPrecision(p)
    if (concept && SHARE_CAPITAL.has(concept.split(':').pop()!)) {
      return { kind: 'actual', places: (SCALE_POWERS as Record<string, number>)[level] ?? 0 }
    }
    return { kind: 'statement', fallbackPlaces: statementPlaces }
  }

  private displayValue(p: ProjectHandle, concept: string, ref: CellRef, cells: (CellModel | null)[], sign: 1 | -1): string {
    const A = p.authority.authority
    const first = cells.find((c) => c && c.v !== null && c.v !== '')
    const raw = first?.v as string | number | boolean
    if (A.isNumeric(concept)) {
      const isMonetary = A.dataType(concept) === 'monetary'
      const amount = rangeAmount(cells, this.precisionFor(p, concept))
      if (amount === null) throw new ValidationError([`“${String(raw)}” is not a number, but ${A.label(concept)} needs an amount.`])
      if (isMonetary) this.refuseLostDigits(p, ref, amount)
      // an actual value is declared to its full accuracy: "4.1783" lakhs of share capital is ₹4,17,830 to the rupee
      const shown = amount.placesFrom === 'actual' ? Dec.toFixed(Dec.parse(amount.value), amount.places) : amount.value
      return withSign(shown, sign)
    }
    if (A.dataType(concept) === 'boolean') {
      const t = String(raw).trim().toLowerCase()
      if (['yes', 'true', 'y'].includes(t)) return 'true'
      if (['no', 'false', 'n'].includes(t)) return 'false'
      throw new ValidationError([`${A.label(concept)} needs Yes or No.`])
    }
    return String(raw).trim()
  }

  /** Never round away a digit the statement shows: MCA wants the actual figures. */
  private refuseLostDigits(p: ProjectHandle, ref: CellRef, amount: CellAmount): void {
    const { level, displayPlaces } = this.filingPrecision(p)
    const places = Dec.fractionDigits(Dec.parse(amount.value))
    if (places <= displayPlaces) return
    throw new ValidationError([
      `${ref.sheet}!${ref.ref} shows ${amount.value} (${places} decimal places), but amounts in ${level === 'Actual' ? 'rupees' : level} can have at most ${displayPlaces}. Nothing was tagged: a digit would be lost.`,
    ])
  }

  private applyFact(p: ProjectHandle, concept: string, scope: Scope, display: string): void {
    try {
      // recalc: calculation totals left empty follow their tagged parts (HPL has no cell for Total fixed assets);
      // a total that is itself tagged is kept, and the calculation check shows any difference
      p.session.setValue(concept, scope, display, { strict: true, recalc: true })
    } catch (err) {
      throw new ValidationError([err instanceof Error ? err.message : String(err)])
    }
  }

  private removeFact(p: ProjectHandle, e: MappingEntry): void {
    const fact = this.fact(p, e)
    if (!fact) return
    try {
      // through the session, so totals derived from this figure are re-derived (or removed)
      p.session.setValue(e.fact.concept, e.fact.scope, '', { recalc: true })
    } catch {
      p.session.filing.removeFact(fact.key)
    }
    if (this.fact(p, e)) p.session.filing.removeFact(fact.key)
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
