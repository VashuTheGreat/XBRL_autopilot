import { useState } from 'react'
import type { FillSource, LibraryRecord, MasterRowView } from '@shared/masters'
import { Button, Checkbox, Dialog } from '@/components/ui/primitives'
import { useMasters } from '@/stores/masters'

/** What a "Fill from master" button offers: rows of a master grid of this filing and / or saved library records. */
export interface FillChoice {
  /** the table to fill */
  tableId: string
  title: string
  rows?: { tableId: string; rows: MasterRowView[]; titleOf(row: MasterRowView): string }
  library: LibraryRecord[]
}

/** Pick the masters to copy into a table; rows that are already there are skipped by main. */
export function FillFromMasterDialog(props: { choice: FillChoice | null; onClose(): void }) {
  const fill = useMasters((s) => s.fill)
  const [members, setMembers] = useState<Set<string>>(new Set())
  const [ids, setIds] = useState<Set<string>>(new Set())
  const c = props.choice
  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set)
    if (!next.delete(key)) next.add(key)
    return next
  }
  const close = () => {
    setMembers(new Set())
    setIds(new Set())
    props.onClose()
  }
  const run = async () => {
    if (!c) return
    const sources: FillSource[] = []
    if (c.rows && members.size) sources.push({ kind: 'rows', tableId: c.rows.tableId, members: [...members] })
    if (ids.size) sources.push({ kind: 'library', ids: [...ids] })
    for (const from of sources) await fill({ tableId: c.tableId, from })
    close()
  }
  const empty = !c?.rows?.rows.length && !c?.library.length

  return (
    <Dialog
      open={!!c}
      onClose={close}
      title={c ? `Fill from master: ${c.title}` : ''}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void run()} disabled={!members.size && !ids.size}>
            Fill
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-xs" data-testid="fill-from-master">
        {empty && <p className="text-muted">No masters to fill from yet. Enter them in the Masters panel, or save one to the library.</p>}
        {!!c?.rows?.rows.length && (
          <section className="flex flex-col gap-1">
            <h3 className="text-[11px] font-semibold">In this filing</h3>
            {c.rows.rows.map((r) => (
              <Checkbox key={r.member} checked={members.has(r.member)} onChange={() => setMembers(toggle(members, r.member))} label={c.rows!.titleOf(r)} />
            ))}
          </section>
        )}
        {!!c?.library.length && (
          <section className="flex flex-col gap-1">
            <h3 className="text-[11px] font-semibold">Master library</h3>
            {c.library.map((r) => (
              <Checkbox key={r.id} checked={ids.has(r.id)} onChange={() => setIds(toggle(ids, r.id))} label={r.title} />
            ))}
          </section>
        )}
      </div>
    </Dialog>
  )
}
