/**
 * TableSuggestionService (ADR-0013): auto-tagging's table blocks — an Excel range matched to one taxonomy table —
 * kept as suggestions in mapping.json `blockSuggestions` until the user accepts or rejects them. Electron-free.
 *
 * Nothing is tagged by a suggestion. Accepting one applies it through TableMappingService (the engine re-plans every
 * cell, so a cell the engine refuses stays untagged and is reported), as is or as the user edited it in "Map as table".
 * A run replaces the open suggestions; a rejected one (same range, same table) is not suggested again, and a range
 * that already holds a table block is not suggested.
 */
import { randomUUID } from 'node:crypto'
import type { BlockSuggestion, TableBlockInput, TableBlockResult } from '@shared/editor'
import { overlaps } from '@shared/workbook'
import { ValidationError } from './errors'
import type { ProjectAccess, ProjectHandle } from './ports'
import type { TableMappingService } from './table-mapping-service'

export type NewBlockSuggestion = Omit<BlockSuggestion, 'id' | 'status'>

export class TableSuggestionService {
  constructor(
    private readonly projects: ProjectAccess,
    private readonly tables: TableMappingService,
    private readonly newId: () => string = randomUUID,
  ) {}

  /** The open and rejected suggestions. */
  list(): BlockSuggestion[] {
    return this.all(this.projects.project())
  }

  /** Stores a run's block suggestions in place of the previous run's open ones. Returns how many were stored. */
  replace(items: NewBlockSuggestion[]): number {
    const p = this.projects.project()
    const rejected = this.all(p).filter((s) => s.status === 'rejected')
    const applied = this.tables.list()
    const added: BlockSuggestion[] = []
    for (const s of items) {
      const skip = rejected.some((r) => sameBlock(r, s)) || applied.some((b) => overlaps(b.cell, s.cell)) || added.some((a) => overlaps(a.cell, s.cell))
      if (!skip) added.push({ ...structuredClone(s), id: this.newId(), status: 'suggested' })
    }
    p.content.mapping.blockSuggestions = [...rejected, ...added]
    p.touch()
    return added.length
  }

  /**
   * Applies an open suggestion: as suggested (provenance `table` with its confidence), or as the user edited it
   * (`edited`, a manual choice). When no cell can be tagged nothing changes and the reasons are given.
   */
  async accept(id: string, edited?: TableBlockInput): Promise<TableBlockResult> {
    const p = this.projects.project()
    const s = this.open(p, id)
    const input: TableBlockInput = edited ?? { cell: s.cell, tableId: s.tableId, rows: s.rows, cols: s.cols, ...(s.sign ? { sign: s.sign } : {}) }
    const provenance = edited ? { origin: 'manual' as const, confidence: null } : { origin: 'table' as const, confidence: s.confidence }
    return p.batch(async () => {
      const result = await this.tables.apply(input, provenance)
      if (!result.tagged) {
        this.tables.remove(result.block.id)
        const why = result.problems.slice(0, 3).map((x) => `${x.cell.ref}: ${x.problems[0]}`)
        throw new ValidationError([`No cell of ${s.cell.sheet}!${s.cell.ref} could be tagged as ${s.tableTitle}.`, ...why])
      }
      p.content.mapping.blockSuggestions = this.all(p).filter((x) => x.id !== id)
      p.touch()
      return result
    })
  }

  reject(id: string): BlockSuggestion {
    const p = this.projects.project()
    const s = this.open(p, id)
    s.status = 'rejected'
    p.touch()
    return s
  }

  private open(p: ProjectHandle, id: string): BlockSuggestion {
    const s = this.all(p).find((x) => x.id === id)
    if (!s || s.status !== 'suggested') throw new ValidationError(['That table suggestion is no longer open.'])
    return s
  }

  private all(p: ProjectHandle): BlockSuggestion[] {
    return (p.content.mapping.blockSuggestions as BlockSuggestion[] | undefined) ?? []
  }
}

const sameBlock = (a: Pick<BlockSuggestion, 'cell' | 'tableId'>, b: Pick<BlockSuggestion, 'cell' | 'tableId'>) =>
  a.tableId === b.tableId && a.cell.workbook === b.cell.workbook && a.cell.sheet === b.cell.sheet && a.cell.ref === b.cell.ref
