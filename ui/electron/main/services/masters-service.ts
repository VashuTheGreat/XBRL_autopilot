/**
 * MastersService (docs/14 Step 9): the Masters panel over the open filing. The company card, the auditor grid and the
 * signatory grids read and write the filing's own CY facts (engine masters.ts, through the Session's checks); the
 * library keeps saved masters across filings; "Fill from master" copies master rows or library records into another
 * table that reports the same elements (the directors' report signatories, the group-company table). Electron-free.
 */
import {
  fillTableFromRecords,
  fillTargets,
  masterItemValues,
  masterSections,
  masterTableRows,
  nextMasterMember,
  panPairs,
  removeMasterRow,
  setMasterCell,
  setMasterItem,
  type MasterField,
  type MasterSection,
  type MasterTable,
  type Session,
} from '@xap/engine'
import {
  cardKind,
  gridKind,
  recordTitle,
  type FillFromMasterInput,
  type FillFromMasterResult,
  type FillTargetView,
  type LibraryRecord,
  type MasterGridView,
  type MastersView,
  type MasterRowRef,
  type SaveMasterInput,
  type SetMasterCellInput,
  type SetMasterItemInput,
} from '@shared/masters'
import { engineProblems, ValidationError } from './errors'
import type { MasterLibraryStore, ProjectAccess } from './ports'

type MastersAuthority = Parameters<typeof masterSections>[0]
type Authority = MastersAuthority & { qnameOfLocal(local: string): string | null }

const SECTIONS = new WeakMap<object, MasterSection[]>()
const localName = (q: string) => q.replace(/^[^:]*:/, '')

export class MastersService {
  constructor(
    private readonly projects: ProjectAccess,
    private readonly library: MasterLibraryStore,
  ) {}

  view(): MastersView {
    const { A, session } = this.open()
    const sections = this.sections(A)
    const own = ownTables(sections)
    return {
      sections: sections.map((s) => ({
        id: s.id,
        title: s.title,
        elrUris: s.elrUris,
        items: s.items,
        values: masterItemValues(session, s.items),
        grids: s.tables.map((t) => this.grid(A, session, t, own)),
        targets: targetsView(A, fillTargets(A, s.items.map((f) => f.concept), own)),
        libraryKind: cardKind(s.id),
      })),
      library: this.library.list(),
    }
  }

  setItem(input: SetMasterItemInput): void {
    const { A, session, touch } = this.open()
    if (!this.sections(A).some((s) => s.items.some((f) => f.concept === input.concept))) throw new ValidationError(['That element is not on a master card.'])
    this.edit(() => setMasterItem(session, input.concept, input.value), touch)
  }

  setCell(input: SetMasterCellInput): void {
    const { A, session, touch } = this.open()
    const t = this.table(A, input.tableId)
    if (!t.columns.some((c) => c.concept === input.concept)) throw new ValidationError(['That element is not a column of this master.'])
    this.edit(() => setMasterCell(session, t.tableId, t.axis, input.member, input.concept, input.value), touch)
  }

  /** The member of a new, empty row (it exists once a cell of it has a value). */
  newRow(tableId: string): string {
    const { A, session } = this.open()
    const t = this.table(A, tableId)
    return nextMasterMember(session, t.tableId, t.axis)
  }

  removeRow(ref: MasterRowRef): void {
    const { A, session, touch } = this.open()
    const t = this.table(A, ref.tableId)
    this.edit(() => removeMasterRow(session, t.tableId, t.axis, ref.member), touch)
  }

  /** Copies master rows or library records into a master grid or one of its fill targets; rows already there are skipped. */
  fill(input: FillFromMasterInput): FillFromMasterResult {
    const { A, session, touch } = this.open()
    const sections = this.sections(A)
    const own = ownTables(sections)
    const allowed = own.has(input.tableId) || sections.some((s) => fillTargets(A, masterConcepts(s), own).some((t) => t.tableId === input.tableId))
    if (!allowed) throw new ValidationError(['That table cannot be filled from the masters.'])
    const records = this.records(A, session, input)
    if (!records.length) throw new ValidationError(['Choose at least one master to fill from.'])
    let result = { added: [] as string[], skipped: 0 }
    this.edit(
      () => (result = fillTableFromRecords(session, input.tableId, records)),
      () => result.added.length && touch(),
    )
    return { added: result.added.length, skipped: result.skipped }
  }

  /** Saves a card or a grid row of this filing to the library. */
  save(input: SaveMasterInput): LibraryRecord {
    const { A, session } = this.open()
    const sections = this.sections(A)
    if ('sectionId' in input) {
      const s = sections.find((x) => x.id === input.sectionId)
      if (!s) throw new ValidationError(['Unknown master.'])
      return this.saveValues(cardKind(s.id), masterItemValues(session, s.items), s.items)
    }
    const t = this.table(A, input.tableId)
    const row = masterTableRows(session, t).find((r) => r.member === input.member)
    if (!row) throw new ValidationError(['That row has no values yet.'])
    return this.saveValues(gridKind(t.tableId), row.values, t.columns)
  }

  forget(id: string): void {
    this.library.remove(id)
  }

  private saveValues(kind: string, values: Record<string, string>, fields: MasterField[]): LibraryRecord {
    if (!Object.keys(values).length) throw new ValidationError(['Enter some details before saving them as a master.'])
    const byLocal = Object.fromEntries(Object.entries(values).map(([q, v]) => [localName(q), v]))
    const order = fields.filter((f) => !f.options).map((f) => f.concept)
    return this.library.save({ kind, title: recordTitle(values, order), values: byLocal })
  }

  private records(A: Authority, session: Session, input: FillFromMasterInput): Record<string, string>[] {
    if (input.from.kind === 'rows') {
      const members = new Set(input.from.members)
      return masterTableRows(session, this.table(A, input.from.tableId))
        .filter((r) => members.has(r.member))
        .map((r) => r.values)
    }
    const ids = new Set(input.from.ids)
    return this.library
      .list()
      .filter((r) => ids.has(r.id))
      .map((r) => toQnames(A, r.values))
  }

  private grid(A: Authority, session: Session, t: MasterTable, own: Set<string>): MasterGridView {
    const concepts = t.columns.map((c) => c.concept)
    return {
      ...t,
      rows: masterTableRows(session, t),
      panPairs: panPairs(A, concepts),
      targets: targetsView(A, fillTargets(A, concepts, own)),
      libraryKind: gridKind(t.tableId),
    }
  }

  private table(A: Authority, tableId: string): MasterTable {
    const t = this.sections(A).flatMap((s) => s.tables).find((x) => x.tableId === tableId)
    if (!t) throw new ValidationError(['That table is not a master.'])
    return t
  }

  private sections(A: Authority): MasterSection[] {
    let s = SECTIONS.get(A)
    if (!s) SECTIONS.set(A, (s = masterSections(A)))
    return s
  }

  private open() {
    const p = this.projects.project()
    return { A: p.authority.authority as unknown as Authority, session: p.session as Session, touch: () => p.touch() }
  }

  private edit(change: () => void, touch: () => void): void {
    try {
      change()
    } catch (err) {
      throw new ValidationError(engineProblems(err))
    }
    touch()
  }
}

const ownTables = (sections: MasterSection[]) => new Set(sections.flatMap((s) => s.tables.map((t) => t.tableId)))
const masterConcepts = (s: MasterSection) => [...s.items.map((f) => f.concept), ...s.tables.flatMap((t) => t.columns.map((c) => c.concept))]

function targetsView(A: Authority, targets: ReturnType<typeof fillTargets>): FillTargetView[] {
  return targets.map((t) => ({ ...t, shared: t.shared.map((q) => A.label(q)) }))
}

/** Library values (by local name) as this taxonomy's elements; names the taxonomy doesn't have are dropped. */
function toQnames(A: Authority, values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [local, v] of Object.entries(values)) {
    const q = A.qnameOfLocal(local)
    if (q) out[q] = v
  }
  return out
}
