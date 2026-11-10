import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export function EmptyState(props: { icon: LucideIcon; title: string; children?: ReactNode; phase?: string }) {
  const Icon = props.icon
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted">
      <Icon size={28} strokeWidth={1.5} />
      <div className="text-sm font-medium text-fg">{props.title}</div>
      {props.children && <div className="max-w-sm text-xs leading-relaxed">{props.children}</div>}
      {props.phase && (
        <div className="mt-1 rounded border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide">
          {props.phase}
        </div>
      )}
    </div>
  )
}
