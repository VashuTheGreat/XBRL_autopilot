import { Building2, FolderTree, Search, Settings, Sparkles, TriangleAlert, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useUi, type Activity } from '@/stores/ui'

const ITEMS: { id: Activity; label: string; icon: LucideIcon }[] = [
  { id: 'explorer', label: 'Filing explorer', icon: FolderTree },
  { id: 'taxonomy', label: 'Taxonomy', icon: Search },
  { id: 'problems', label: 'Problems', icon: TriangleAlert },
  { id: 'ai', label: 'AI assistant', icon: Sparkles },
  { id: 'masters', label: 'Masters (company, directors, auditor)', icon: Building2 },
]

export function ActivityBar() {
  const { activity, sidebarOpen, setActivity } = useUi()
  const button = (id: Activity, label: string, Icon: LucideIcon) => {
    const active = sidebarOpen && activity === id
    return (
      <button
        key={id}
        title={label}
        aria-label={label}
        aria-pressed={active}
        onClick={() => setActivity(id)}
        className={cn(
          'relative flex h-11 w-11 items-center justify-center text-muted hover:text-fg',
          active && 'text-fg before:absolute before:left-0 before:h-6 before:w-0.5 before:bg-accent',
        )}
      >
        <Icon size={20} strokeWidth={1.75} />
      </button>
    )
  }
  return (
    <nav className="flex w-11 shrink-0 flex-col items-center border-r border-border bg-panel-2">
      {ITEMS.map((i) => button(i.id, i.label, i.icon))}
      <div className="flex-1" />
      {button('settings', 'Settings', Settings)}
    </nav>
  )
}
