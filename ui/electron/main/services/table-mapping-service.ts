/**
 * TableMappingService (ADR-0013): an Excel range mapped to one taxonomy table — rows → line items (with their period
 * role and members), columns → members (and year). Electron-free.
 *
 * The engine plans the block (`planTableBlock`: one fact per non-empty cell, with its problems); this service reads
 * the cells, shows the plan as a preview, and applies it cell by cell through MappingService.tag, so every block cell
 * is an ordinary tag (one fact ← one cell, linkage both ways, reapply, untag) that carries its block's id. The block
 * itself (its row and column assignment) is kept in mapping.json `blocks`, so it can be shown and removed as a unit.
 */
import { randomUUID } from 'node:crypto'
import { planTableBlock, UnknownTableError, type TableBlockSpec } from '@xap/engine'
import type { MappingEntry, TableBlock, TableBlockCellPlan, TableBlockInput, TableBlockPlan, TableBlockResult } from '@shared/editor'
import { rangeOf, toA1, type CellRef } from '@shared/workbook'
import type { ColumnPeriodService } from './column-period-service'
import { ValidationError } from './errors'
import type { MappingService, TagProvenance } from './mapping-service'
import type { ProjectAccess, ProjectHandle } from './ports'
import type { SourceService } from './source-service'

const MAX_BLOCK_CELLS = 5_000

export class TableMappingService {
  constructor(
    private readonly projects: ProjectAccess,
    private readonly sources: SourceService,
    private readonly columns: ColumnPeriodService,
    private readonly mapping: MappingService,
    private readonly newId: () => string = randomUUID,
  ) {}

  /** What the block would file, cell by cell (no changes). */
  async plan(input: TableBlockInput): Promise<TableBlockPlan> {
    const p = this.projects.project()
    const A = p.authority.authority
    const range = this.check(input)
    const sheet = await this.sources.sheet(input.cell)
    const filled = new Set(sheet.cells.filter((c) => c.v !== null && c.v !== '').map((c) => `${c.r}:${c.c}`))
    const scopes = new Map<number, 'CY' | 'PY' | null>()
    for (const col of input.cols) {
      const at: CellRef = { ...input.cell, ref: toA1(range.r1, col.c) }
      scopes.set(col.c, (await this.columns.of(at)).scope)
    }
    let planned
    try {
      planned = planTableBlock(A, this.spec(input), { hasValue: (r, c) => filled.has(`${r}:${c}`), columnScope: (c) => scopes.get(c) ?? null })
    } catch (err) {
      if (err instanceof UnknownTableError) throw new ValidationError([err.message])
      throw err
    }
    const cells: TableBlockCellPlan[] = []
    for (const x of planned) {
      const cell: CellRef = { ...input.cell, ref: toA1(x.r, x.c) }
      const value = await this.mapping.amountFor(cell, x.concept, input.sign ?? 1)
      const problems = [...x.problems]
      if (value === null && A.isNumeric(x.concept)) problems.push('This cell is not a number.')
      cells.push({ cell, concept: x.concept, conceptLabel: A.label(x.concept), scope: x.scope, dims: x.dims, preferredLabel: x.preferredLabel, value, problems })
    }
    const ready = cells.filter((c) => !c.problems.length).length
    const table = A.table(input.tableId) as { hypercube: string }
    return { tableId: input.tableId, tableTitle: A.label(table.hypercube), cells, ready, blocked: cells.length - ready }
  }

  /**
   * Tags every ready cell of the block (a block over the same range is replaced). Cells the engine refuses are
   * reported and left untagged; the others stay tagged.
   */
  async apply(input: TableBlockInput, provenance?: TagProvenance): Promise<TableBlockResult> {
    const p = this.projects.project()
    const plan = await this.plan(input)
    return p.batch(async () => {
      for (const old of this.blocks(p).filter((b) => b.cell.workbook === input.cell.workbook && b.cell.sheet === input.cell.sheet && b.cell.ref === input.cell.ref)) {
        this.remove(old.id)
      }
      const block: TableBlock = { ...structuredClone(input), id: this.newId(), origin: provenance?.origin ?? 'manual', confidence: provenance?.confidence ?? null }
      const problems: TableBlockResult['problems'] = []
      let tagged = 0
      for (const c of plan.cells) {
        if (c.problems.length) {
          problems.push({ cell: c.cell, problems: c.problems })
          continue
        }
        try {
          await this.mapping.tag(
            { cell: c.cell, concept: c.concept, scope: c.scope!, dims: c.dims, tableId: input.tableId, preferredLabel: c.preferredLabel, sign: input.sign ?? 1 },
            provenance,
            { blockId: block.id },
          )
          tagged++
        } catch (err) {
          problems.push({ cell: c.cell, problems: err instanceof ValidationError ? err.problems : [String(err)] })
        }
      }
      p.content.mapping.blocks = [...this.blocks(p), block]
      p.touch()
      return { block, tagged, problems }
    })
  }

  list(): TableBlock[] {
    return this.blocks(this.projects.project())
  }

  /** Untags every cell of the block (each removes its facts) and forgets the block. */
  remove(blockId: string): void {
    const p = this.projects.project()
    if (!this.blocks(p).some((b) => b.id === blockId)) throw new ValidationError(['That table mapping no longer exists.'])
    for (const e of (p.content.mapping.entries as MappingEntry[]).filter((x) => x.blockId === blockId)) this.mapping.untag(e.id)
    p.content.mapping.blocks = this.blocks(p).filter((b) => b.id !== blockId)
    p.touch()
  }

  private blocks(p: ProjectHandle): TableBlock[] {
    return (p.content.mapping.blocks as TableBlock[] | undefined) ?? []
  }

  private check(input: TableBlockInput) {
    const range = rangeOf(input.cell.ref)
    if (!range) throw new ValidationError([`"${input.cell.ref}" is not a range.`])
    if ((range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1) > MAX_BLOCK_CELLS) throw new ValidationError([`A table block can have at most ${MAX_BLOCK_CELLS} cells.`])
    if (!input.rows.length || !input.cols.length) throw new ValidationError(['Give the block at least one row (line item) and one column.'])
    const outside = [...input.rows.map((r) => r.r < range.r1 || r.r > range.r2), ...input.cols.map((c) => c.c < range.c1 || c.c > range.c2)]
    if (outside.some(Boolean)) throw new ValidationError(['Every mapped row and column must lie inside the selected range.'])
    return range
  }

  private spec(input: TableBlockInput): TableBlockSpec {
    return { tableId: input.tableId, rows: input.rows, cols: input.cols }
  }
}
