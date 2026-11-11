/**
 * A synthetic Ind AS filing for service tests, without a sidecar: the knowledge-base authority and a workbook laid out
 * like DGPL's statements and its PPE schedule (sheet FA) — no client data.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CellModel, CellRef, SheetModel } from '@shared/workbook'
import { AppDatabase } from '../../electron/main/infra/app-database'
import { DirAutosaveStore } from '../../electron/main/infra/dir-autosave-store'
import { ColumnPeriodService } from '../../electron/main/services/column-period-service'
import { MappingService } from '../../electron/main/services/mapping-service'
import { ProjectService } from '../../electron/main/services/project-service'
import { SourceService } from '../../electron/main/services/source-service'
import { TableMappingService } from '../../electron/main/services/table-mapping-service'
import { kbAuthorityService } from './kb-authorities'

export const P = 'ind-as:'
export const GROSS = { axis: `${P}CarryingAmountAccumulatedDepreciationAndGrossCarryingAmountAxis`, member: `${P}GrossCarryingAmountMember` }
export const COMPUTERS = { axis: `${P}ClassesOfPropertyPlantAndEquipmentAxis`, member: `${P}ComputerEquipmentsMember` }
export const OFFICE = { axis: `${P}ClassesOfPropertyPlantAndEquipmentAxis`, member: `${P}OfficeEquipmentMember` }
export const SHARES1 = { axis: `${P}ClassesOfEquityShareCapitalAxis`, member: `${P}EquityShares1Member` }
export const PPE_TABLE = '400600:DisclosureOfPropertyPlantAndEquipmentTable'
export const SHARES_TABLE = '400100:DisclosureOfClassesOfEquityShareCapitalTable'
export const PPE_NOTE = 'http://www.icai.org/xbrl/taxonomy/2017-03-31/ind-as-roles/NotesPropertyPlantAndEquipment_400600'

export const sheet = (name: string, rows: Record<number, Record<number, string | number>>): SheetModel => {
  const cells: CellModel[] = []
  for (const [r, cols] of Object.entries(rows)) for (const [c, v] of Object.entries(cols)) cells.push({ r: Number(r), c: Number(c), v })
  return { name, rowCount: 40, colCount: 8, cells, merges: [], colWidths: {} } as SheetModel
}

// BS: CY in C, PY in D (header dates). FA: classes in B/C; gross block rows with their period in the label.
export const WORKBOOK = [
  sheet('BS', {
    0: { 0: 'Particulars', 2: 'As at 31 March 2026', 3: 'As at 31 March 2025' },
    2: { 0: 'Property, plant and equipment', 2: 1.23456, 3: 0.86 },
    3: { 0: 'Equity share capital', 2: 10, 3: 10 },
  }),
  sheet('FA', {
    4: { 1: 'Computers', 2: 'Office equipment' },
    5: { 0: 'Gross block as at 1 April 2024', 1: 0.73, 2: 0.13 },
    6: { 0: 'Additions', 1: 0, 2: 0 },
    7: { 0: 'Balance as at 31 March 2025', 1: 0.73, 2: 0.13 },
    8: { 0: 'Additions', 1: 0.5 },
    9: { 0: 'Balance as at 31 March 2026', 1: 1.23, 2: 0.13 },
    10: { 0: 'Note', 1: 'see policy' },
  }),
]

export const cell = (s: string, ref: string): CellRef => ({ workbook: 'workbook-1.xlsx', sheet: s, ref })

/** A new FY 2025-26 Ind AS filing in lakhs (2 places) with WORKBOOK imported, and the mapping services over it. */
export async function syntheticIndAsFiling() {
  const dir = mkdtempSync(join(tmpdir(), 'xap-tables-'))
  const projects = new ProjectService({ authority: kbAuthorityService(), recents: new AppDatabase(':memory:'), autosave: new DirAutosaveStore(join(dir, 'a')), appVersion: '0.1.0' })
  const sources = new SourceService(projects, async (source, fileName) => ({ source, fileName, sheets: structuredClone(WORKBOOK) }))
  const columns = new ColumnPeriodService(projects, sources)
  const mapping = new MappingService(projects, sources, columns)
  const tables = new TableMappingService(projects, sources, columns, mapping)
  await projects.newFiling({
    taxonomy: 'ind-as-2017', companyName: 'Synthetic Pvt Ltd', cin: 'U72200KA2010PTC123456', reportType: 'Standalone',
    cy: { start: '2025-04-01', end: '2026-03-31' }, py: { start: '2024-04-01', end: '2025-03-31' }, level: 'Lakhs', statementPlaces: 2,
  })
  await sources.importWorkbook('synthetic.xlsx', new Uint8Array([1]))
  /** the filed value of a fact (null when it isn't filed) */
  const value = (concept: string, scope: 'CY' | 'PY', dims: object[] = [], preferredLabel: string | null = null) =>
    (projects.session().getValue(concept, scope, dims as never, preferredLabel) as { value: string } | null)?.value ?? null
  return { dir, projects, sources, columns, mapping, tables, value }
}
