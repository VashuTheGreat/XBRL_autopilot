import { ChevronDown, ChevronRight, FolderTree } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ElrInfo } from '@shared/project'
import { EmptyState } from '@/components/EmptyState'
import { useProject } from '@/stores/project'

const GROUPS: ElrInfo['group'][] = ['Statements', 'Notes', 'Disclosures']

/** ELR tree of the open filing. Completion/error status dots arrive with validation (Phase 6). */
export function FilingExplorer() {
  const { summary, elrs } = useProject()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['Notes', 'Disclosures']))
  const [filter, setFilter] = useState('')
  const grouped = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const match = (e: ElrInfo) => !q || e.code.includes(q) || e.title.toLowerCase().includes(q)
    return GROUPS.map((g) => ({ group: g, items: elrs.filter((e) => e.group === g && match(e)) }))
  }, [elrs, filter])

  if (!summary) {
    return (
      <EmptyState icon={FolderTree} title="No filing open">
        Create or open a filing to see its statements, notes and disclosures.
      </EmptyState>
    )
  }
  const toggle = (g: string) =>
    setCollapsed((s) => {
      const n = new Set(s)
      if (n.has(g)) n.delete(g)
      else n.add(g)
      return n
    })

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2">
        <div className="truncate text-[13px] font-medium">{summary.company.name}</div>
        <div className="truncate font-mono text-[11px] text-muted">{summary.company.cin}</div>
        <div className="mt-0.5 text-[11px] text-muted">
          {summary.fyLabel} · {summary.reportType} · {summary.level}
        </div>
      </div>
      <div className="px-2 py-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter statements…"
          className="h-7 w-full rounded border border-border bg-panel px-2 text-xs outline-none focus:border-accent select-text"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-2 text-[12px]" role="tree">
        {grouped.map(({ group, items }) => (
          <div key={group} role="group">
            <button
              className="flex w-full items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-fg"
              onClick={() => toggle(group)}
              aria-expanded={!collapsed.has(group)}
            >
              {collapsed.has(group) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              {group} <span className="font-normal">({items.length})</span>
            </button>
            {!collapsed.has(group) &&
              items.map((e) => (
                <div
                  key={e.uri}
                  role="treeitem"
                  title={`[${e.code}] ${e.title}`}
                  className="flex cursor-default items-baseline gap-2 truncate py-0.5 pr-2 pl-6 hover:bg-panel-2"
                >
                  <span className="shrink-0 font-mono text-[10px] text-muted">{e.code}</span>
                  <span className="truncate">{e.title}</span>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}
