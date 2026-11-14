import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { panNameConcepts, type MasterFieldView, type PanPairView } from '@shared/masters'
import { useMasters } from '@/stores/masters'
import { MasterFieldInput } from './MasterFieldInput'

/** A section's non-dimensional items, under their taxonomy headings; the first heading starts open. */
export function MasterCard(props: { items: MasterFieldView[]; values: Record<string, string>; pairs: PanPairView[] }) {
  const setItem = useMasters((s) => s.setItem)
  const names = panNameConcepts(props.pairs)
  const groups = groupByHeading(props.items)
  return (
    <div className="flex flex-col gap-1">
      {groups.map((g, i) => (
        <HeadingGroup key={g.heading} title={g.heading} initiallyOpen={i === 0}>
          {g.fields.map((f) => (
            <MasterFieldInput key={f.concept} field={f} values={props.values} pairs={props.pairs} panName={names.has(f.concept)} onWrite={(value) => void setItem({ concept: f.concept, value })} />
          ))}
        </HeadingGroup>
      ))}
    </div>
  )
}

function HeadingGroup(props: { title: string; initiallyOpen: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(props.initiallyOpen)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div>
      <button type="button" className="flex w-full items-center gap-1 py-1 text-left text-[11px] font-medium text-fg hover:text-accent" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Chevron size={12} /> {props.title}
      </button>
      {open && <div className="flex flex-col gap-2 pb-2 pl-4">{props.children}</div>}
    </div>
  )
}

function groupByHeading(items: MasterFieldView[]): { heading: string; fields: MasterFieldView[] }[] {
  const groups = new Map<string, MasterFieldView[]>()
  for (const f of items) {
    const h = f.heading ?? 'Details'
    groups.set(h, [...(groups.get(h) ?? []), f])
  }
  return [...groups].map(([heading, fields]) => ({ heading, fields }))
}
