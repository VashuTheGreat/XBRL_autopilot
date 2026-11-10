import { Building2, Search, Sparkles, TriangleAlert } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { FilingExplorer } from '@/features/explorer/FilingExplorer'
import { SettingsPanel } from '@/features/settings/SettingsPanel'
import { useUi, type Activity } from '@/stores/ui'

const TITLES: Record<Activity, string> = {
  explorer: 'Filing explorer',
  taxonomy: 'Taxonomy',
  problems: 'Problems',
  ai: 'AI assistant',
  masters: 'Masters',
  settings: 'Settings',
}

export function SidePanel() {
  const activity = useUi((s) => s.activity)
  return (
    <aside className="flex h-full flex-col bg-panel">
      <header className="flex h-8 shrink-0 items-center border-b border-border px-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {TITLES[activity]}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        {activity === 'explorer' && <FilingExplorer />}
        {activity === 'taxonomy' && (
          <EmptyState icon={Search} title="Taxonomy browser" phase="Phase 4">
            Search C&amp;I 2016 elements and drag one onto an Excel cell to tag it.
          </EmptyState>
        )}
        {activity === 'problems' && (
          <EmptyState icon={TriangleAlert} title="No problems" phase="Phase 6">
            Validation errors, warnings and MCA tool messages will be grouped by statement here.
          </EmptyState>
        )}
        {activity === 'ai' && (
          <EmptyState icon={Sparkles} title="AI assistant" phase="Phases 5 & 7">
            Auto-tag the workbook, review tagging quality, and let the agent propose fixes for validation errors.
          </EmptyState>
        )}
        {activity === 'masters' && (
          <EmptyState icon={Building2} title="Company masters" phase="Phase 4">
            Company, directors and auditor details (General Information, ELR 400100) — edited in the XBRL Form.
          </EmptyState>
        )}
        {activity === 'settings' && <SettingsPanel />}
      </div>
    </aside>
  )
}
