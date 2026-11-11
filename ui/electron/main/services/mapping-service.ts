/**
 * MappingService: Excel cell (or a one-column range, summed) ↔ taxonomy fact. Tagging writes the value into the engine
 * filing; untagging removes it. The engine stays the source of truth for values; mapping.json records where they came
 * from.
 *
 * Invariants (ADR-0013):
 * - one fact ← one cell (ranges count by their cells);
 * - one cell → one main fact, plus "also reported as" facts of the same figure (a balance-sheet line that is also a
 *   table's member column). Every value change of the cell (tag, re-tag, change of year, reapply after the decimal
 *   places change) writes all of them; untagging removes all of them.
 * A fact may be a table fact (dims): it is written through Session.setTableValue, so the engine checks its table,
 * members and applicability exactly as it checks a plain fact.
 *
 * Auto-tagging suggestions are entries with status 'suggested' (or 'rejected' once the user says no). They carry no
 * fact: only an approved entry has one. Accepting a suggestion is an ordinary tag() with its provenance.
 * Every approved plain tag teaches the mapping memory (label → concept).
 */
import { randomUUID } from 'node:crypto'
import { decimal as Dec, dimKey, nondimAllowed, normDims, SCALE_POWERS, SHARE_CAPITAL, tableOfFact } from '@xap/engine'
import {
  displayLabel,
  type AlsoReportedView,
  type AlsoReportInput,
  type CellAmount,
  type CellInfo,
  type ColumnPeriod,
  type DimRef,
  type MappedFact,
  type MappingEntry,
  type MappingOrigin,
  type MappingStatus,
  type MappingView,
  type Scope,
  type SuggestedAlso,
  type SuggestionAlternative,
  type TagCellInput,
} from '@shared/editor'
import { overlaps, rangeCells, rangeOf, sameCell, type CellModel, type CellRef } from '@shared/workbook'
import { withSign } from '../mapping/amounts'
import { rangeAmount, type AmountPrecision } from '../mapping/cell-amount'
import type { ColumnPeriodService } from './column-period-service'
import { ValidationError } from './errors'
import type { MappingMemoryRepository, ProjectAccess, ProjectHandle } from './ports'
import type { SourceService } from './source-service'

type Fact = { key: string; value: string | null; nil?: boolean }

/** Where a tag came from, when it was not chosen by hand (an accepted auto-tagging suggestion). */
export interface TagProvenance {
  origin: MappingOrigin
  confidence: number | null
  rationale?: string
}

/** An auto-tagging suggestion to store (AutoTagService). */
export interface NewSuggestion {
  cell: CellRef
  label: string
  concept: string
  scope: Scope
  sign: 1 | -1
  origin: MappingOrigin
  confidence: number
  rationale: string
  alternatives: SuggestionAlternative[]
  /** "also reported as" facts proposed for the same figure */
  also?: SuggestedAlso[]
}

/**
 * Options of a tag made by another service: the block that creates it, the "also reported as" facts it keeps, and
 * the suggested ones it carries (an accepted suggestion keeps its proposals for review).
 */
export interface TagOptions {
  blockId?: string
  also?: MappedFact[]
  alsoSuggested?: SuggestedAlso[]
}

type TargetInput = Pick<TagCellInput, 'concept' | 'dims' | 'tableId' | 'preferredLabel'>

const NO_MEMORY: MappingMemoryRepository = { recall: () => [], remember: () => {} }
const hasFact = (e: MappingEntry) => e.status === 'approved'
/** the main fact, then the "also reported as" facts */
const factsOf = (e: MappingEntry): MappedFact[] => [e.fact, ...(e.also ?? [])]
/** Only the opening-balance role changes which fact a row is (its period); negated / total roles are display. */
const periodRole = (f: MappedFact) => (f.preferredLabel === 'periodStartLabel' ? 'start' : '')
export const sameFact = (a: MappedFact, b: MappedFact): boolean =>
  a.concept === b.concept && a.scope === b.scope && dimKey(a.dims) === dimKey(b.dims) && periodRole(a) === periodRole(b)

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
    private readonly memory: MappingMemoryRepository = NO_MEMORY,
    private readonly newId: () => string = randomUUID,
  ) {}

  list(): MappingView[] {
    const p = this.projects.project()
    return this.entries(p).map((e) => this.view(p, e))
  }

  async tag(input: TagCellInput, provenance?: TagProvenance, opts: TagOptions = {}): Promise<MappingView> {
    const p = this.projects.project()
    const A = p.authority.authority
    const target = this.target(p, input)
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
    const fact: MappedFact = { ...target, scope }
    this.applyFact(p, fact, this.displayValue(p, fact.concept, input.cell, cells, sign))

    // one cell → one main fact and one fact ← one cell: older mappings that clash are replaced. Re-tagging the same
    // cell keeps its "also reported as" facts: they follow the cell's figure.
    const entries = this.entries(p)
    const clash = (e: MappingEntry) =>
      overlaps(e.cell, input.cell) || (hasFact(e) ? factsOf(e).some((f) => sameFact(f, fact)) : sameFact(e.fact, fact))
    const previous = entries.find((e) => hasFact(e) && sameCell(e.cell, input.cell))
    const kept = opts.also ?? previous?.also ?? []
    const also = kept.filter((f) => !sameFact(f, fact))
    const alsoSuggested = (opts.alsoSuggested ?? previous?.alsoSuggested ?? []).filter((f) => ![fact, ...also].some((x) => sameFact(x, f)))
    for (const old of entries.filter(clash)) if (hasFact(old)) this.removeFacts(p, old, [fact, ...also])
    for (const f of also) this.applyFact(p, f, this.displayValue(p, f.concept, input.cell, cells, sign))
    const label = await this.sources.rowLabel(input.cell)
    const entry: MappingEntry = {
      id: this.newId(),
      cell: { ...input.cell },
      label,
      fact,
      ...(also.length ? { also } : {}),
      ...(alsoSuggested.length ? { alsoSuggested } : {}),
      ...(opts.blockId ? { blockId: opts.blockId } : {}),
      sign,
      origin: provenance?.origin ?? 'manual',
      confidence: provenance?.confidence ?? null,
      ...(provenance?.rationale ? { rationale: provenance.rationale } : {}),
      status: 'approved', // a person chose it, or accepted the suggestion
    }
    this.setEntries(p, [...entries.filter((e) => !clash(e)), entry])
    // the memory learns plain tags (label → element); table cells are learnt as blocks
    if (label && !fact.dims.length) this.memory.remember(p.authority.taxonomyId, label, fact.concept)
    p.touch()
    return this.view(p, entry)
  }

  /**
   * "Also reported as": files a tagged cell's figure as one more fact (same year unless given). Refused when that fact
   * already comes from another cell (one fact ← one cell) or is already this cell's.
   */
  async addAlso(input: AlsoReportInput): Promise<MappingView> {
    const p = this.projects.project()
    const e = this.find(p, input.mappingId)
    if (!hasFact(e)) throw new ValidationError(['Tag the cell (or accept its suggestion) first.'])
    const fact: MappedFact = { ...this.target(p, input), scope: input.scope ?? e.fact.scope }
    if (fact.scope === 'PY' && !p.periods().py) throw new ValidationError(['This is the company’s first financial year: there are no previous-year figures.'])
    if (factsOf(e).some((f) => sameFact(f, fact))) throw new ValidationError(['This cell already reports that fact.'])
    const other = this.entries(p).find((x) => x.id !== e.id && hasFact(x) && factsOf(x).some((f) => sameFact(f, fact)))
    if (other) throw new ValidationError([`That fact already comes from ${other.cell.sheet}!${other.cell.ref}. Untag it there first.`])
    const { cells } = await this.sources.cell(e.cell)
    this.applyFact(p, fact, this.displayValue(p, fact.concept, e.cell, cells, e.sign))
    e.also = [...(e.also ?? []), fact]
    p.touch()
    return this.view(p, e)
  }

  /**
   * Accepts a suggested "also reported as" fact (by its position in `alsoSuggested`) of a tagged cell: it is filed
   * like any addAlso, and leaves the suggestions.
   */
  async acceptAlso(mappingId: string, index: number): Promise<MappingView> {
    const p = this.projects.project()
    const e = this.find(p, mappingId)
    const s = e.alsoSuggested?.[index]
    if (!s) throw new ValidationError(['That suggestion is no longer open.'])
    if (!hasFact(e)) throw new ValidationError(['Accept the cell’s own tag first.'])
    await this.addAlso({ mappingId, concept: s.concept, dims: s.dims, scope: s.scope, ...(s.tableId ? { tableId: s.tableId } : {}), preferredLabel: s.preferredLabel ?? null })
    this.dropAlsoSuggestion(e, s)
    p.touch()
    return this.view(p, e)
  }

  /** Drops a suggested "also reported as" fact (by its position in `alsoSuggested`). */
  rejectAlso(mappingId: string, index: number): MappingView {
    const p = this.projects.project()
    const e = this.find(p, mappingId)
    const s = e.alsoSuggested?.[index]
    if (!s) throw new ValidationError(['That suggestion is no longer open.'])
    this.dropAlsoSuggestion(e, s)
    p.touch()
    return this.view(p, e)
  }

  /** Stops reporting one "also reported as" fact (by its position in the entry's list): the fact is removed. */
  removeAlso(mappingId: string, index: number): MappingView {
    const p = this.projects.project()
    const e = this.find(p, mappingId)
    const f = e.also?.[index]
    if (!f) throw new ValidationError(['That fact is no longer reported from this cell.'])
    this.removeFact(p, f)
    const rest = e.also!.filter((_, i) => i !== index)
    if (rest.length) e.also = rest
    else delete e.also
    p.touch()
    return this.view(p, e)
  }

  /**
   * Stores a run's suggestions in place of the previous run's. A suggestion is skipped when its cell or its fact is
   * already tagged, or the user rejected that element for that cell before. Writes no fact.
   */
  replaceSuggestions(items: NewSuggestion[]): { added: number; skipped: number } {
    const p = this.projects.project()
    const kept = this.entries(p).filter((e) => e.status !== 'suggested')
    const approved = kept.filter(hasFact)
    const rejected = kept.filter((e) => e.status === 'rejected')
    const added: MappingEntry[] = []
    const taken = approved.flatMap(factsOf)
    for (const s of items) {
      const fact: MappedFact = { concept: s.concept, scope: s.scope, dims: [] }
      const skip =
        approved.some((e) => overlaps(e.cell, s.cell)) ||
        taken.some((f) => sameFact(f, fact)) ||
        rejected.some((e) => sameCell(e.cell, s.cell) && e.fact.concept === s.concept)
      if (skip) continue
      taken.push(fact)
      // a proposed "also" fact another cell already supplies (or this one twice) is not proposed
      const alsoSuggested = (s.also ?? []).filter((f) => !taken.some((t) => sameFact(t, f)))
      taken.push(...alsoSuggested)
      added.push({
        id: this.newId(),
        cell: { ...s.cell },
        label: s.label,
        fact,
        sign: s.sign,
        origin: s.origin,
        confidence: s.confidence,
        rationale: s.rationale,
        alternatives: s.alternatives,
        ...(alsoSuggested.length ? { alsoSuggested } : {}),
        status: 'suggested',
      })
    }
    // a rejected entry on a cell that now has a different suggestion is superseded by it
    const superseded = (e: MappingEntry) => e.status === 'rejected' && added.some((a) => sameCell(a.cell, e.cell))
    this.setEntries(p, [...kept.filter((e) => !superseded(e)), ...added])
    p.touch()
    return { added: added.length, skipped: items.length - added.length }
  }

  /** The approved tag of exactly this cell (or range), if any. */
  approvedAt(cell: CellRef): MappingView | null {
    const p = this.projects.project()
    const e = this.entries(p).find((x) => hasFact(x) && sameCell(x.cell, cell))
    return e ? this.view(p, e) : null
  }

  /** A stored entry by id (for AutoTagService's accept / reject). */
  get(id: string): MappingView {
    const p = this.projects.project()
    return this.view(p, this.find(p, id))
  }

  /** Removes the tag and every fact it supplies (main and "also reported as"). */
  untag(id: string): void {
    const p = this.projects.project()
    const entry = this.find(p, id)
    if (hasFact(entry)) this.removeFacts(p, entry)
    this.setEntries(p, this.entries(p).filter((e) => e.id !== id))
    p.touch()
  }

  /** Moves a tag to the other year. `provenance`: who decided (an accepted AI patch keeps origin 'ai' and its confidence). */
  async setScope(id: string, scope: Scope, provenance?: TagProvenance): Promise<MappingView> {
    const p = this.projects.project()
    const e = this.find(p, id)
    if (e.fact.scope === scope) return this.view(p, e)
    // the "also reported as" facts of the same year (filed or suggested) move with it
    const move = <T extends MappedFact>(f: T): T => (f.scope === e.fact.scope ? { ...f, scope } : f)
    if (!hasFact(e)) {
      // a suggestion: correct it before accepting
      if (e.alsoSuggested) e.alsoSuggested = e.alsoSuggested.map(move)
      e.fact = { ...e.fact, scope }
      p.touch()
      return this.view(p, e)
    }
    const also = (e.also ?? []).map(move)
    const alsoSuggested = (e.alsoSuggested ?? []).map(move)
    this.untag(id)
    const { concept, dims, tableId, preferredLabel } = e.fact
    const view = await this.tag({ cell: e.cell, concept, dims, tableId: tableId ?? undefined, preferredLabel, scope, sign: e.sign }, provenance, {
      also,
      alsoSuggested,
      ...(e.blockId ? { blockId: e.blockId } : {}),
    })
    // correcting a cell's period corrects its column: later cells of the column follow
    await this.columns.set(e.cell, scope)
    return view
  }

  /**
   * Re-pulls every tagged figure from Excel at the filing's current precision (after "decimal places as presented"
   * changed), into the main fact and every "also reported as" fact. Returns the problems of tags that could not be
   * re-applied; those tags keep their previous value.
   */
  async reapply(): Promise<string[]> {
    const p = this.projects.project()
    const problems: string[] = []
    for (const e of this.entries(p).filter(hasFact)) {
      try {
        const { cells } = await this.sources.cell(e.cell)
        for (const f of factsOf(e)) this.applyFact(p, f, this.displayValue(p, f.concept, e.cell, cells, e.sign))
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

  /** A cell's amount as it would go into the filing as `concept` (table-block previews). */
  async amountFor(ref: CellRef, concept: string, sign: 1 | -1 = 1): Promise<string | null> {
    const p = this.projects.project()
    const { cells } = await this.sources.cell(ref)
    try {
      return this.displayValue(p, concept, ref, cells, sign)
    } catch {
      return null
    }
  }

  /** Rejects a suggestion, or brings a rejected one back. Approving goes through tag() (it writes the fact). */
  setStatus(id: string, status: MappingStatus): MappingView {
    const p = this.projects.project()
    const e = this.find(p, id)
    if (status === e.status) return this.view(p, e)
    if (status === 'approved' || hasFact(e)) {
      throw new ValidationError([status === 'approved' ? 'Accept the suggestion to tag it.' : 'This cell is tagged: untag it instead.'])
    }
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

  private fact(p: ProjectHandle, f: MappedFact): Fact | null {
    return (p.session.getValue(f.concept, f.scope, f.dims, f.preferredLabel ?? null) as Fact | null) ?? null
  }

  private view(p: ProjectHandle, e: MappingEntry): MappingView {
    const approved = hasFact(e)
    const fact = approved ? this.fact(p, e.fact) : null
    const A = p.authority.authority as unknown as {
      conceptElrs(q: string): string[]
      elr(u: string): { code: string } | null
      label(q: string): string
      table(id: string): { presentationElr: string } | null
    }
    const code = (u: string) => A.elr(u)?.code ?? '~'
    const memberLabels = (dims: DimRef[]) => dims.map((d) => (d.member ? displayLabel(A.label(d.member)) : String(d.typed)))
    // a table fact is shown in its table's statement / note; a plain fact wherever its element is presented
    const tableElr = e.fact.tableId ? A.table(e.fact.tableId)?.presentationElr : null
    const alsoViews: AlsoReportedView[] = (e.also ?? []).map((f) => {
      const x = approved ? this.fact(p, f) : null
      return {
        fact: f,
        conceptLabel: A.label(f.concept),
        memberLabels: memberLabels(f.dims),
        factKey: x?.key ?? null,
        value: x ? String(p.session.displayOf(x)) : null,
      }
    })
    const alsoSuggestedViews = (e.alsoSuggested ?? []).map((f) => ({ fact: f, conceptLabel: A.label(f.concept), memberLabels: memberLabels(f.dims) }))
    return {
      ...e,
      conceptLabel: A.label(e.fact.concept),
      elrUris: tableElr ? [tableElr] : [...A.conceptElrs(e.fact.concept)].sort((a, b) => code(a).localeCompare(code(b))),
      factKey: fact?.key ?? null,
      factKeys: [fact?.key, ...alsoViews.map((a) => a.factKey)].filter((k): k is string => !!k),
      value: fact ? String(p.session.displayOf(fact)) : null,
      alsoViews,
      alsoSuggestedViews,
    }
  }

  private dropAlsoSuggestion(e: MappingEntry, s: SuggestedAlso): void {
    const rest = (e.alsoSuggested ?? []).filter((x) => x !== s)
    if (rest.length) e.alsoSuggested = rest
    else delete e.alsoSuggested
  }

  /** The fact a tag input names, without its year: checked, members normalised, its table found. */
  private target(p: ProjectHandle, input: TargetInput): Omit<MappedFact, 'scope'> {
    const A = p.authority.authority
    if (!A.concept(input.concept) || !A.isReportable(input.concept)) throw new ValidationError([`${input.concept} is not a reportable taxonomy element.`])
    const dims = (normDims(input.dims ?? []) as DimRef[]).map((d): DimRef => (d.member ? { axis: d.axis, member: d.member } : { axis: d.axis, typed: String(d.typed) }))
    const preferredLabel = input.preferredLabel ?? null
    if (!dims.length) {
      if (!nondimAllowed(A, input.concept)) {
        throw new ValidationError([
          `“${A.label(input.concept)}” is reported inside a table (with axes): give its members. Select the table’s range and use “Map as table”, or tag the cell with its members.`,
        ])
      }
      return { concept: input.concept, dims, tableId: null, preferredLabel }
    }
    const tableId = input.tableId ?? tableOfFact(A, input.concept, dims)
    if (!tableId) throw new ValidationError([`No table of the taxonomy reports “${A.label(input.concept)}” with these members.`])
    return { concept: input.concept, dims, tableId, preferredLabel }
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

  private applyFact(p: ProjectHandle, f: MappedFact, display: string): void {
    try {
      // recalc: calculation totals left empty follow their tagged parts (HPL has no cell for Total fixed assets);
      // a total that is itself tagged is kept, and the calculation check shows any difference
      this.write(p, f, display, true)
    } catch (err) {
      // an applicability refusal carries the rule's reason (e.g. "SR-L694-1: condition not determinable"): say it
      const reasons = (err as { reasons?: unknown }).reasons
      const why = Array.isArray(reasons) && reasons.length ? ` (${reasons.slice(0, 2).join('; ')})` : ''
      throw new ValidationError([`${err instanceof Error ? err.message : String(err)}${why}`])
    }
  }

  private write(p: ProjectHandle, f: MappedFact, display: string, strict: boolean): void {
    const preferredLabel = f.preferredLabel ?? null
    if (f.dims.length) p.session.setTableValue(f.tableId!, f.scope, f.dims, f.concept, display, { preferredLabel, strict, recalc: true })
    else p.session.setValue(f.concept, f.scope, display, { preferredLabel, strict, recalc: true })
  }

  /** Removes every fact of an entry, except those in `keep` (just written by the tag that replaces it). */
  private removeFacts(p: ProjectHandle, e: MappingEntry, keep: MappedFact[] = []): void {
    for (const f of factsOf(e)) if (!keep.some((k) => sameFact(k, f))) this.removeFact(p, f)
  }

  private removeFact(p: ProjectHandle, f: MappedFact): void {
    const fact = this.fact(p, f)
    if (!fact) return
    try {
      // through the session, so totals derived from this figure are re-derived (or removed)
      this.write(p, f, '', false)
    } catch {
      p.session.filing.removeFact(fact.key)
    }
    if (this.fact(p, f)) p.session.filing.removeFact(fact.key)
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
