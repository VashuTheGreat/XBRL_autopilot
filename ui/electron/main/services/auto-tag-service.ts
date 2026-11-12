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
import { displayLabel, type AcceptAllResult, type AutoTagColumnOptions, type AutoTagSummary, type MappingView, type SuggestedAlso } from '@shared/editor'
import { columnLetter, fromA1, toA1, type WorkbookModel } from '@shared/workbook'
import { sidecarCall } from '../infra/sidecar-call'
import { KB_TAXONOMY_ID } from '../infra/sidecar-taxonomy-catalog'
import { ValidationError } from './errors'
import type { MappingService, NewSuggestion } from './mapping-service'
import type { MappingMemoryRepository, MappingSuggester, ProjectAccess, SidecarClient, Suggestion, SuggestRequest, SuggestedBlock } from './ports'
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
    private readonly sidecar?: SidecarClient,
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

  async runColumn(options: AutoTagColumnOptions): Promise<AutoTagSummary> {
    const p = this.projects.project()
    const workbooks = await this.sources.workbooks()
    if (!workbooks.length) throw new ValidationError(['Import the Excel financial statements first.'])
    const wb = workbooks.find((w) => !options.workbook || w.source === options.workbook) ?? workbooks[0]!
    const sheet = wb.sheets.find((s) => !options.sheet || s.name === options.sheet) ?? wb.sheets[0]!

    const labelParsed = fromA1(`${options.labelColumn.toUpperCase()}1`)
    const cyParsed = fromA1(`${options.cyColumn.toUpperCase()}1`)
    if (!labelParsed || !cyParsed) {
      throw new ValidationError(['Invalid column identifier. Use letters like B, C, D.'])
    }
    const labelCol = labelParsed.c
    const cyCol = cyParsed.c
    let pyCol: number | undefined
    if (options.pyColumn) {
      const pParsed = fromA1(`${options.pyColumn.toUpperCase()}1`)
      if (pParsed) pyCol = pParsed.c
    } else if (options.gap !== undefined && options.gap > 0) {
      pyCol = cyCol + options.gap
    }

    // Filter out empty, blank, or purely numeric/date cells
    const validRows: Array<{ row: number; text: string; cyCell: string; pyCell?: string }> = []
    const cellsByRow = new Map<number, typeof sheet.cells[0]>()
    for (const c of sheet.cells) {
      if (c.c === labelCol) {
        cellsByRow.set(c.r, c)
      }
    }

    const sortedRows = Array.from(cellsByRow.keys()).sort((a, b) => a - b)
    for (const r of sortedRows) {
      const c = cellsByRow.get(r)!
      const text = String(c.v ?? '').trim()
      if (!text) continue
      // skip pure numbers
      if (/^-?\d+(\.\d+)?$/.test(text)) continue

      validRows.push({
        row: r,
        text,
        cyCell: toA1(r, cyCol),
        pyCell: pyCol !== undefined ? toA1(r, pyCol) : undefined,
      })
    }

    if (!validRows.length) {
      return { suggested: 0, skipped: 0, blocks: 0, sheets: [], llmUsed: false }
    }

    if (!this.sidecar) {
      throw new ValidationError(['AI engine sidecar is not connected.'])
    }

    const taxonomyId = KB_TAXONOMY_ID[p.authority.taxonomyId] ?? p.authority.taxonomyId
    const recResults = await sidecarCall<Array<{
      key: string
      bestMatch: { qname: string; label: string; score: number; confidencePercent: number } | null
      matches: Array<{ qname: string; label: string; score: number }>
    }>>(this.sidecar, 'POST', '/api/v1/taxonomies/recommend', {
      what: 'Auto-tagging recommendation',
      body: {
        keys: validRows.map((r) => r.text),
        collection: taxonomyId,
        top_k: 3,
      },
    })

    const recMap = new Map<string, (typeof recResults)[0]>()
    for (const res of recResults) {
      recMap.set(res.key, res)
    }

    const items: NewSuggestion[] = []
    const hasPy = !!p.periods().py

    for (const row of validRows) {
      const match = recMap.get(row.text)
      if (!match || !match.bestMatch) continue
      const best = match.bestMatch
      const alternatives = (match.matches ?? []).map((m) => ({
        concept: m.qname,
        label: m.label,
        score: m.score,
      }))

      items.push({
        cell: { workbook: wb.source, sheet: sheet.name, ref: row.cyCell },
        label: row.text,
        concept: best.qname,
        scope: 'CY',
        confidence: best.score,
        origin: best.score >= 0.95 ? 'exact' : 'lexical',
        rationale: `Matched via Hybrid Retrieval (${Math.round(best.score * 100)}%)`,
        sign: 1,
        alternatives,
      })

      if (row.pyCell && hasPy) {
        items.push({
          cell: { workbook: wb.source, sheet: sheet.name, ref: row.pyCell },
          label: row.text,
          concept: best.qname,
          scope: 'PY',
          confidence: best.score,
          origin: best.score >= 0.95 ? 'exact' : 'lexical',
          rationale: `Matched via Hybrid Retrieval (${Math.round(best.score * 100)}%)`,
          sign: 1,
          alternatives,
        })
      }
    }

    return p.batch(async () => {
      const colKeyCY = `${wb.source}|${sheet.name}|${columnLetter(cyCol)}`
      p.content.mapping.columns = { ...p.content.mapping.columns, [colKeyCY]: 'CY' }
      if (pyCol !== undefined && hasPy) {
        const colKeyPY = `${wb.source}|${sheet.name}|${columnLetter(pyCol)}`
        p.content.mapping.columns = { ...p.content.mapping.columns, [colKeyPY]: 'PY' }
      }

      // Remember sheet column settings
      const m = p.content.mapping as Record<string, unknown>
      m.sheetColumnSettings = m.sheetColumnSettings ?? {}
      ;(m.sheetColumnSettings as Record<string, unknown>)[`${wb.source}|${sheet.name}`] = {
        labelColumn: columnLetter(labelCol),
        cyColumn: columnLetter(cyCol),
        pyColumn: pyCol !== undefined ? columnLetter(pyCol) : undefined,
        gap: options.gap,
      }

      const { added, skipped } = this.mapping.replaceSuggestions(items)
      return {
        suggested: added,
        skipped,
        blocks: 0,
        sheets: [{ workbook: wb.source, sheet: sheet.name, kind: 'column', rows: added, note: null }],
        llmUsed: false,
      }
    })
  }

  /** Tags the suggested cell with the suggested element (or `concept`, one of its alternatives). */
  async accept(id: string, concept?: string): Promise<MappingView> {
    const s = this.suggestion(id)
    const chosen = concept ?? s.fact.concept
    const picked = chosen === s.fact.concept ? s : s.alternatives?.find((a) => a.concept === chosen)
    if (!picked) throw new ValidationError([`${chosen} is not one of this cell's suggestions.`])
    const own = chosen === s.fact.concept
    // the suggested element keeps its members and its number in the cell's text; an alternative is a plain tag
    const table = own && s.fact.dims.length ? { dims: s.fact.dims, tableId: s.fact.tableId ?? undefined, preferredLabel: s.fact.preferredLabel ?? null } : {}
    return this.mapping.tag(
      { cell: s.cell, concept: chosen, scope: s.fact.scope, sign: own ? s.sign : 1, ...table, ...(s.pick !== undefined ? { pick: s.pick } : {}) },
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

/** The workbook's cells as the tagger reads them: values and merged ranges (no formulas, formats or file name). */
function toSheets(wb: WorkbookModel): SuggestRequest['sheets'] {
  return wb.sheets.map((s) => ({
    name: s.name,
    cells: s.cells.filter((c) => c.v !== null && c.v !== '').map((c) => ({ r: c.r, c: c.c, v: c.v as string | number | boolean })),
    merges: s.merges.map((m) => ({ r1: m.r1, c1: m.c1, r2: m.r2, c2: m.c2 })),
  }))
}

function toSuggestion(workbook: string, s: Suggestion): NewSuggestion {
  // an "also" fact is the same figure: the same year as the cell's suggestion unless it says otherwise
  const also: SuggestedAlso[] = (s.also ?? []).map((a) => ({
    concept: a.concept,
    scope: a.scope ?? s.scope,
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
    ...(s.dims?.length ? { dims: s.dims, ...(s.tableId ? { tableId: s.tableId } : {}), preferredLabel: s.preferredLabel ?? null } : {}),
    ...(s.pick !== undefined ? { pick: s.pick } : {}),
  }
}

function toBlock(workbook: string, b: SuggestedBlock): NewBlockSuggestion {
  return {
    cell: { workbook, sheet: b.sheet, ref: b.range },
    tableId: b.tableId,
    tableTitle: displayLabel(b.tableTitle),
    confidence: b.confidence,
    cellCount: b.cells.length,
    rows: b.rows.map((r) => ({
      r: r.r,
      concept: r.concept,
      preferredLabel: r.preferredLabel ?? null,
      ...(r.scope ? { scope: r.scope } : {}),
      members: r.members ?? [],
      ...(r.cols ? { cols: r.cols } : {}),
      ...(r.also?.length ? { also: r.also } : {}),
    })),
    cols: b.cols.map((c) => ({ c: c.c, members: c.members ?? [], ...(c.scope ? { scope: c.scope } : {}), ...(c.alsoTotal?.length ? { alsoTotal: c.alsoTotal } : {}) })),
  }
}
