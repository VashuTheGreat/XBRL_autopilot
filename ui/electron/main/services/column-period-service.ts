/**
 * ColumnPeriodService: which period (CY / PY) a value column of a sheet stands for.
 * The user's choice for a column wins and is remembered per sheet in mapping.json (`columns`); otherwise the
 * column header or the sheet layout decides (scope-inference). A header naming another period is never overridden
 * by a guess: the user is asked (3rd-year columns, stale "As at 30th September, 2019" headers).
 */
import type { ColumnPeriod, Scope } from '@shared/editor'
import { columnLetter, type CellRef } from '@shared/workbook'
import { inferScope } from '../mapping/scope-inference'
import { ValidationError } from './errors'
import type { ProjectAccess, ProjectHandle } from './ports'
import type { SourceService } from './source-service'

type Columns = Record<string, Scope>

export class ColumnPeriodService {
  constructor(
    private readonly projects: ProjectAccess,
    private readonly sources: SourceService,
  ) {}

  async of(cell: CellRef): Promise<ColumnPeriod> {
    const p = this.projects.project()
    const { sheet, at } = await this.sources.cell(cell)
    const column = columnLetter(at.c)
    const remembered = this.columns(p)[columnKey(cell, column)]
    if (remembered) return { column, scope: remembered, basis: 'remembered', reason: `you set column ${column} to ${remembered}` }
    const periods = p.periods()
    const guess = inferScope(sheet, at, periods)
    if (!guess) return { column, scope: null, basis: 'unknown', reason: 'no period header above this column' }
    if (guess.basis === 'outside') {
      return { column, scope: null, basis: 'outside', reason: `${guess.reason} is not this filing’s current or previous year` }
    }
    if (guess.scope === 'PY' && !periods.py) {
      return { column, scope: null, basis: 'outside', reason: `${guess.reason}: this is the company’s first financial year, there is no previous year` }
    }
    return { column, scope: guess.scope, basis: guess.basis, reason: guess.reason }
  }

  /** Remembers (or with null forgets) the period of the cell's column on its sheet. */
  async set(cell: CellRef, scope: Scope | null): Promise<ColumnPeriod> {
    const p = this.projects.project()
    if (scope === 'PY' && !p.periods().py) throw new ValidationError(['This is the company’s first financial year: there are no previous-year figures.'])
    const { at } = await this.sources.cell(cell)
    const key = columnKey(cell, columnLetter(at.c))
    const columns = { ...this.columns(p) }
    if (columns[key] === (scope ?? undefined)) return this.of(cell)
    if (scope) columns[key] = scope
    else delete columns[key]
    p.content.mapping.columns = columns
    p.touch()
    return this.of(cell)
  }

  private columns(p: ProjectHandle): Columns {
    return p.content.mapping.columns ?? {}
  }
}

const columnKey = (cell: CellRef, column: string) => `${cell.workbook}|${cell.sheet}|${column}`
