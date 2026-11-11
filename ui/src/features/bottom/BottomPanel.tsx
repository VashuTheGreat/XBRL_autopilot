import { RotateCw, Sparkles } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { EmptyState } from '@/components/EmptyState'
import { Tabs } from '@/components/Tabs'
import { cn } from '@/lib/cn'
import { useSidecar } from '@/stores/sidecar'
import { useUi } from '@/stores/ui'
import { useValidation } from '@/stores/validation'
import { ProblemsPanel } from './ProblemsPanel'

function OutputLog() {
  const logs = useSidecar((s) => s.logs)
  const end = useRef<HTMLDivElement>(null)
  // Block body on purpose: scrollIntoView() returns a Promise in recent Chromium, and React would
  // treat a returned value as the effect's cleanup ("destroy_ is not a function").
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [logs.length])
  return (
    <div className="h-full overflow-auto px-3 py-2 font-mono text-[11px] leading-5 select-text" data-testid="output-log">
      {logs.length === 0 && <div className="text-muted">No output yet.</div>}
      {logs.map((l, i) => (
        <div key={i} className={cn(l.stream === 'stderr' && 'text-muted', l.stream === 'system' && 'text-accent')}>
          <span className="text-muted">{new Date(l.ts).toLocaleTimeString()} </span>
          {l.text}
        </div>
      ))}
      <div ref={end} />
    </div>
  )
}

export function BottomPanel() {
  const { bottomTab, setBottomTab } = useUi()
  const errors = useValidation((s) => s.view?.summary.errors ?? 0)
  return (
    <section className="flex h-full flex-col bg-panel" aria-label="Bottom panel">
      <Tabs
        value={bottomTab}
        onChange={setBottomTab}
        tabs={[
          { id: 'problems', label: 'Problems', badge: errors },
          { id: 'ai', label: 'AI Agent' },
          { id: 'output', label: 'Output' },
        ]}
        right={
          bottomTab === 'output' ? (
            <button
              className="flex items-center gap-1 px-3 text-muted hover:text-fg"
              title="Restart AI engine"
              onClick={() => void window.xap?.sidecar.restart()}
            >
              <RotateCw size={12} /> Restart AI engine
            </button>
          ) : null
        }
      />
      <div className="min-h-0 flex-1">
        {bottomTab === 'problems' && <ProblemsPanel />}
        {bottomTab === 'ai' && (
          <EmptyState icon={Sparkles} title="AI agent idle" phase="Phase 10">
            Proposed fixes appear here as reviewable patches. Nothing is changed until you accept.
          </EmptyState>
        )}
        {bottomTab === 'output' && <OutputLog />}
      </div>
    </section>
  )
}
