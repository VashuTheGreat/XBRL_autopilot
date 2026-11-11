/**
 * AutoTagService: asks the MappingSuggester (the sidecar's tagger, docs/06) for tags of every imported workbook and
 * stores them as suggestions. Nothing reaches the filing until the user accepts: accept() is MappingService.tag()
 * with the suggestion's provenance, which also teaches the mapping memory.
 *
 * A run gives three kinds of suggestion, each stored by the service that owns it:
 * - a cell → one plain fact (MappingService entries with status 'suggested');
 * - "also reported as" facts on such a cell (`alsoSuggested`, accepted one by one, never in "Accept all");
 * - a block → one taxonomy table (TableSuggestionService, mapping.json `blockSuggestions`).
 *
 * Sends: the workbook cells (values only), the filing's period ends and rounding level, and the mapping memory.
 * The LLM rerank runs only with the user's AI consent (Settings) and a Groq key (the sidecar checks the key).
 */
import { displayLabel, type AcceptAllResult, type AutoTagSummary, type MappingView, type SuggestedAlso } from '@shared/editor'
import type { WorkbookModel } from '@shared/workbook'
import { ValidationError } from './errors'
import type { MappingService, NewSuggestion } from './mapping-service'
import type { MappingMemoryRepository, MappingSuggester, ProjectAccess, Suggestion, SuggestRequest, SuggestedBlock } from './ports'
import type { SourceService } from './source-service'
import type { NewBlockSuggestion, TableSuggestionService } from './table-suggestion-service'

export const ACCEPT_ALL_DEFAULT = 0.9

export class AutoTagService {
  constructor(
    private readonly projects: ProjectAccess,
    private readonly sources: SourceService,
    private readonly mapping: MappingService,
    private readonly suggester: MappingSuggester,
    private readonly memory: MappingMemoryRepository,
    private readonly tableSuggestions: TableSuggestionService,
    private readonly aiConsent: () => boolean = () => false,
  ) {}

  async run(): Promise<AutoTagSummary> {
    const p = this.projects.project()
    const workbooks = await this.sources.workbooks()
    if (!workbooks.length) throw new ValidationError(['Import the Excel financial statements first.'])
    const periods = p.periods()
    const base: Omit<SuggestRequest, 'sheets'> = {
      taxonomy: p.authority.taxonomyId,
      periods: { cyEnd: periods.cy.end, pyEnd: periods.py?.end ?? null },
      level: String((p.session.filing.meta as { level?: string }).level ?? 'Actual'),
      memory: this.memory.recall(p.authority.taxonomyId),
      useLlm: this.aiConsent(),
    }
    const items: NewSuggestion[] = []
    const blocks: NewBlockSuggestion[] = []
    const summary: AutoTagSummary = { suggested: 0, skipped: 0, blocks: 0, sheets: [], llmUsed: false }
    for (const wb of workbooks) {
      const res = await this.suggester.suggest({ ...base, sheets: toSheets(wb) })
      summary.llmUsed ||= res.llmUsed
      summary.sheets.push(...res.layout.map((l) => ({ workbook: wb.source, sheet: l.sheet, kind: l.kind, rows: l.rows, note: l.note })))
      items.push(...res.suggestions.map((s) => toSuggestion(wb.source, s)))
      blocks.push(...(res.blocks ?? []).map((b) => toBlock(wb.source, b)))
    }
    return p.batch(async () => {
      const { added, skipped } = this.mapping.replaceSuggestions(items)
      return { ...summary, suggested: added, skipped, blocks: this.tableSuggestions.replace(blocks) }
    })
  }

  /** Tags the suggested cell with the suggested element (or `concept`, one of its alternatives). */
  async accept(id: string, concept?: string): Promise<MappingView> {
    const s = this.suggestion(id)
    const chosen = concept ?? s.fact.concept
    const picked = chosen === s.fact.concept ? s : s.alternatives?.find((a) => a.concept === chosen)
    if (!picked) throw new ValidationError([`${chosen} is not one of this cell's suggestions.`])
    const own = chosen === s.fact.concept
    return this.mapping.tag(
      { cell: s.cell, concept: chosen, scope: s.fact.scope, sign: own ? s.sign : 1 },
      own ? { origin: s.origin, confidence: s.confidence, rationale: s.rationale } : { origin: 'manual', confidence: null },
      // the proposed "also" facts are for the suggested element's figure: they stay open for review
      own && s.alsoSuggested ? { alsoSuggested: s.alsoSuggested } : {},
    )
  }

  reject(id: string): MappingView {
    this.suggestion(id)
    return this.mapping.setStatus(id, 'rejected')
  }

  /**
   * Accepts every cell suggestion and every table block at or above `min`. One that can't be tagged stays suggested
   * and is reported. Suggested "also reported as" facts are never accepted in bulk: each is a second fact of a figure.
   */
  async acceptAll(min = ACCEPT_ALL_DEFAULT): Promise<AcceptAllResult> {
    const due = this.mapping.list().filter((m) => m.status === 'suggested' && (m.confidence ?? 0) >= min)
    const blocks = this.tableSuggestions.list().filter((b) => b.status === 'suggested' && b.confidence >= min)
    const result: AcceptAllResult = { accepted: 0, blocks: 0, cells: 0, problems: [] }
    const why = (err: unknown) => (err instanceof ValidationError ? err.problems.join(' ') : String(err))
    // one change notification at the end: the views refresh once, not once per tag
    await this.projects.project().batch(async () => {
      for (const m of due) {
        try {
          await this.accept(m.id)
          result.accepted++
        } catch (err) {
          result.problems.push(`${m.cell.sheet}!${m.cell.ref}: ${why(err)}`)
        }
      }
      for (const b of blocks) {
        try {
          const r = await this.tableSuggestions.accept(b.id)
          result.blocks++
          result.cells += r.tagged
        } catch (err) {
          result.problems.push(`${b.cell.sheet}!${b.cell.ref}: ${why(err)}`)
        }
      }
    })
    return result
  }

  private suggestion(id: string): MappingView {
    const m = this.mapping.get(id)
    if (m.status !== 'suggested') throw new ValidationError(['That cell has no open suggestion.'])
    return m
  }
}

/** The workbook's cells as the tagger reads them: values only (no formulas, formats or file name). */
function toSheets(wb: WorkbookModel): SuggestRequest['sheets'] {
  return wb.sheets.map((s) => ({
    name: s.name,
    cells: s.cells.filter((c) => c.v !== null && c.v !== '').map((c) => ({ r: c.r, c: c.c, v: c.v as string | number | boolean })),
  }))
}

function toSuggestion(workbook: string, s: Suggestion): NewSuggestion {
  // an "also" fact is the same figure: the same year as the cell's suggestion
  const also: SuggestedAlso[] = (s.also ?? []).map((a) => ({
    concept: a.concept,
    scope: s.scope,
    dims: a.dims,
    tableId: a.tableId,
    preferredLabel: a.preferredLabel,
    confidence: a.confidence,
    ...(a.reason ? { reason: a.reason } : {}),
  }))
  return {
    cell: { workbook, sheet: s.cell.sheet, ref: s.cell.ref },
    label: s.label,
    concept: s.concept,
    scope: s.scope,
    sign: s.sign,
    origin: s.origin,
    confidence: s.confidence,
    rationale: s.rationale,
    alternatives: s.alternatives,
    ...(also.length ? { also } : {}),
  }
}

function toBlock(workbook: string, b: SuggestedBlock): NewBlockSuggestion {
  return {
    cell: { workbook, sheet: b.sheet, ref: b.range },
    tableId: b.tableId,
    tableTitle: displayLabel(b.tableTitle),
    confidence: b.confidence,
    cellCount: b.cells.length,
    rows: b.rows.map((r) => ({ r: r.r, concept: r.concept, preferredLabel: r.preferredLabel ?? null, ...(r.scope ? { scope: r.scope } : {}), members: r.members ?? [] })),
    cols: b.cols.map((c) => ({ c: c.c, members: c.members ?? [], ...(c.scope ? { scope: c.scope } : {}) })),
  }
}
