import { BookmarkPlus, Building2, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { recordTitle, type FillTargetView, type MasterGridView, type MasterSectionView, type MastersView } from '@shared/masters'
import { EmptyState } from '@/components/EmptyState'
import { Button, Section } from '@/components/ui/primitives'
import { useMasters } from '@/stores/masters'
import { useProject } from '@/stores/project'
import { FillFromMasterDialog, type FillChoice } from './FillFromMasterDialog'
import { MasterCard } from './MasterCard'
import { MasterGrid, titleOrder } from './MasterGrid'

const TITLES: Record<string, string> = { company: 'Company', auditor: 'Auditor', signatories: 'Directors and signatories' }

/**
 * Masters (docs/14 Step 9): the company card, the auditor and signatory grids — all the filing's own CY facts — the
 * "Fill from master" actions for the tables that report the same elements, and the master library kept across filings.
 */
export function MastersPanel() {
  const { view, refresh } = useMasters()
  const revision = useProject((s) => s.summary?.revision)
  const [choice, setChoice] = useState<FillChoice | null>(null)
  useEffect(() => void refresh(), [revision, refresh])

  if (revision === undefined) {
    return (
      <EmptyState icon={Building2} title="Company masters">
        Open or create a filing to enter the company, auditor and directors.
      </EmptyState>
    )
  }
  if (!view) return <p className="p-3 text-xs text-muted">Loading…</p>

  return (
    <div className="flex flex-col gap-5 p-3 text-xs" data-testid="masters-panel">
      {view.sections.map((s) => (
        <MasterSectionBlock key={s.id} section={s} view={view} onChoose={setChoice} />
      ))}
      <LibraryList view={view} />
      <FillFromMasterDialog choice={choice} onClose={() => setChoice(null)} />
    </div>
  )
}

function MasterSectionBlock(props: { section: MasterSectionView; view: MastersView; onChoose(c: FillChoice): void }) {
  const { section: s, view } = props
  const save = useMasters((x) => x.save)
  const library = (kind: string) => view.library.filter((r) => r.kind === kind)
  const pairs = s.grids.flatMap((g) => g.panPairs)
  const fromGrid = (g: MasterGridView, target: { tableId: string; title: string }): FillChoice => ({
    ...target,
    rows: { tableId: g.tableId, rows: g.rows, titleOf: (r) => recordTitle(r.values, titleOrder(g)) },
    library: library(g.libraryKind),
  })
  return (
    <Section title={TITLES[s.id] ?? s.title}>
      {s.items.length > 0 && (
        <>
          <MasterCard items={s.items} values={s.values} pairs={pairs} />
          <Button variant="ghost" className="h-6 self-start px-1.5 text-[11px]" onClick={() => void save({ sectionId: s.id })} title="Save these details to the master library (reuse them in other filings)">
            <BookmarkPlus size={12} /> Save to master library
          </Button>
        </>
      )}
      {s.grids.map((g) => (
        <div key={g.tableId} className="flex flex-col gap-2">
          <MasterGrid grid={g} onFillFromLibrary={() => props.onChoose({ tableId: g.tableId, title: g.title, library: library(g.libraryKind) })} />
          <FillTargets targets={g.targets} action="Fill from master" onPick={(t) => props.onChoose(fromGrid(g, t))} />
        </div>
      ))}
      <FillTargets targets={s.targets} action="Load company name from master" onPick={(t) => props.onChoose({ tableId: t.tableId, title: t.title, library: library(s.libraryKind) })} />
    </Section>
  )
}

/** The tables elsewhere in the filing that take this master's elements, each with its fill button. */
function FillTargets(props: { targets: FillTargetView[]; action: string; onPick(t: FillTargetView): void }) {
  if (!props.targets.length) return null
  return (
    <ul className="flex flex-col gap-1 rounded bg-panel-2 px-2 py-1.5" data-testid="fill-targets">
      {props.targets.map((t) => (
        <li key={t.tableId} className="flex items-center gap-2 text-[11px]">
          <span className="min-w-0 flex-1 truncate" title={`${t.elrTitle}\nTakes: ${t.shared.join(', ')}`}>
            {t.title}
          </span>
          <Button variant="ghost" className="h-6 shrink-0 px-1.5 text-[11px]" onClick={() => props.onPick(t)}>
            {props.action}
          </Button>
        </li>
      ))}
    </ul>
  )
}

function LibraryList({ view }: { view: MastersView }) {
  const forget = useMasters((s) => s.forget)
  return (
    <Section title="Master library">
      <p className="text-[11px] text-muted">Companies, auditors and directors you saved, for every filing on this computer.</p>
      {!view.library.length ? (
        <p className="text-[11px] text-muted">Nothing saved yet.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {view.library.map((r) => (
            <li key={r.id} className="flex items-center gap-1 text-[11px]">
              <span className="min-w-0 flex-1 truncate">{r.title}</span>
              <span className="shrink-0 text-[10px] text-muted">{kindLabel(r.kind, view)}</span>
              <Button variant="ghost" className="h-5 px-1" onClick={() => void forget(r.id)} aria-label={`Remove ${r.title} from the library`}>
                <Trash2 size={11} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

/** "Company", or the grid's title, for a library record's kind. */
function kindLabel(kind: string, view: MastersView): string {
  for (const s of view.sections) {
    if (s.libraryKind === kind) return TITLES[s.id] ?? s.title
    const g = s.grids.find((x) => x.libraryKind === kind)
    if (g) return g.title
  }
  return ''
}
