/**
 * ColumnPeriodService: which period (CY / PY) a value column of a sheet stands for.
 * The user's choice for a column wins and is remembered per sheet in mapping.json (`columns`); otherwise the
 * column header or the sheet layout decides (scope-inference). A header naming another period is never overridden
 * by a guess: the user is asked (3rd-year columns, stale "As at 30th September, 2019" headers).
 */
import type { ColumnPeriod, Scope, SetSheetColumnsInput, SheetColumns } from '@shared/editor'
import { columnLetter, fromA1, type CellRef } from '@shared/workbook'
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

  /** Gets the configured or inferred CY and PY columns for a sheet. */
  async sheetColumns(workbook: string, sheetName: string): Promise<SheetColumns> {
    const p = this.projects.project()
    const cols = this.columns(p)
    const prefix = `${workbook}|${sheetName}|`
    let cyColumn: string | null = null
    let pyColumn: string | null = null

    for (const [key, scope] of Object.entries(cols)) {
      if (key.startsWith(prefix)) {
        const col = key.slice(prefix.length)
        if (scope === 'CY') cyColumn = col
        else if (scope === 'PY') pyColumn = col
      }
    }

    let basis: 'remembered' | 'inferred' | 'unknown' = 'unknown'
    if (cyColumn || pyColumn) {
      basis = 'remembered'
    } else {
      try {
        const sheet = await this.sources.sheet({ workbook, sheet: sheetName })
        const periods = p.periods()
        for (const c of sheet.cells) {
          if (c.r < 15 && typeof c.v === 'number') {
            const letter = columnLetter(c.c)
            const guess = inferScope(sheet, { r: c.r, c: c.c }, periods)
            if (guess && guess.basis !== 'outside') {
              if (guess.scope === 'CY' && !cyColumn) cyColumn = letter
              if (guess.scope === 'PY' && !pyColumn) pyColumn = letter
            }
          }
        }
        if (cyColumn || pyColumn) {
          basis = 'inferred'
        }
      } catch {
        // sheet may not be loaded yet
      }
    }

    let gap: number | undefined
    if (cyColumn && pyColumn) {
      const cyIdx = fromA1(`${cyColumn}1`)?.c
      const pyIdx = fromA1(`${pyColumn}1`)?.c
      if (cyIdx !== undefined && pyIdx !== undefined && pyIdx > cyIdx) {
        gap = pyIdx - cyIdx
      }
    }

    return {
      workbook,
      sheet: sheetName,
      cyColumn,
      pyColumn,
      gap: gap ?? 1,
      basis,
    }
  }

  /** Sets the CY and PY columns for a sheet (or all sheets in the workbook). */
  async setSheetColumns(input: SetSheetColumnsInput): Promise<SheetColumns> {
    const p = this.projects.project()
    const cyUpper = input.cyColumn.trim().toUpperCase()
    let pyUpper = input.pyColumn?.trim().toUpperCase() || null

    if (!fromA1(`${cyUpper}1`)) {
      throw new ValidationError([`Invalid CY column letter: “${input.cyColumn}”. Use letters like C or D.`])
    }

    if (!pyUpper && input.gap && input.gap > 0 && p.periods().py) {
      const cyIdx = fromA1(`${cyUpper}1`)!.c
      pyUpper = columnLetter(cyIdx + input.gap)
    }

    if (pyUpper) {
      if (!fromA1(`${pyUpper}1`)) {
        throw new ValidationError([`Invalid PY column letter: “${input.pyColumn}”. Use letters like D.`])
      }
      if (!p.periods().py) {
        throw new ValidationError(['This is the company’s first financial year: there are no previous-year figures.'])
      }
      if (cyUpper === pyUpper) {
        throw new ValidationError(['CY column and PY column cannot be the same column.'])
      }
    }

    const columns = { ...this.columns(p) }
    let targetSheets = [input.sheet]
    if (input.applyToAllSheets) {
      const wb = (await this.sources.workbooks()).find((w) => w.source === input.workbook)
      if (wb) {
        targetSheets = wb.sheets.map((s) => s.name)
      }
    }

    for (const sh of targetSheets) {
      const prefix = `${input.workbook}|${sh}|`
      for (const key of Object.keys(columns)) {
        if (key.startsWith(prefix) && (columns[key] === 'CY' || columns[key] === 'PY')) {
          delete columns[key]
        }
      }
      columns[`${prefix}${cyUpper}`] = 'CY'
      if (pyUpper) {
        columns[`${prefix}${pyUpper}`] = 'PY'
      }
    }

    p.content.mapping.columns = columns
    p.touch()

    return this.sheetColumns(input.workbook, input.sheet)
  }

  private columns(p: ProjectHandle): Columns {
    return p.content.mapping.columns ?? {}
  }
}

const columnKey = (cell: CellRef, column: string) => `${cell.workbook}|${cell.sheet}|${column}`
