import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface TabDef<T extends string> {
  id: T
  label: string
  badge?: number
}

export function Tabs<T extends string>(props: {
  tabs: TabDef<T>[]
  value: T
  onChange(v: T): void
  right?: ReactNode
}) {
  return (
    <div role="tablist" className="flex h-8 shrink-0 items-stretch border-b border-border bg-panel-2 text-xs">
      {props.tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={props.value === t.id}
          onClick={() => props.onChange(t.id)}
          className={cn(
            'flex items-center gap-1.5 border-r border-border px-3 text-muted hover:text-fg',
            props.value === t.id && 'bg-panel text-fg shadow-[inset_0_-2px_0_var(--accent)]',
          )}
        >
          {t.label}
          {t.badge !== undefined && (
            <span className="tabular rounded bg-border px-1 text-[10px] leading-4">{t.badge}</span>
          )}
        </button>
      ))}
      <div className="flex-1" />
      {props.right}
    </div>
  )
}
