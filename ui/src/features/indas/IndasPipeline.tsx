import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { useIndas, type IndasStep } from '@/stores/indas'
import { FinancialsStep } from './FinancialsStep'
import { GenerateStep } from './GenerateStep'
import { MastersStep } from './MastersStep'
import { TaggingStep } from './TaggingStep'

const STEPS: { id: IndasStep; title: string }[] = [
  { id: 'financials', title: '1 · Financial statements' },
  { id: 'tagging', title: '2 · Tagging' },
  { id: 'masters', title: '3 · Company & auditor' },
  { id: 'generate', title: '4 · Generate XML' },
]

/** Vashu's Ind AS pipeline (docs/17): Excel → canonical sheets → tags → masters → XML. */
export function IndasPipeline() {
  const { step, setStep, closePipeline, busy, progress, transform } = useIndas()
  const at = STEPS.findIndex((s) => s.id === step)
  const canLeaveFirst = transform !== null
  return (
    <div className="flex h-full flex-col bg-bg" data-testid="indas-pipeline">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2">
        <Button variant="ghost" onClick={closePipeline} title="Back to the start screen">
          <ArrowLeft size={14} /> Start
        </Button>
        <h1 className="text-sm font-semibold">Ind AS filing (AOC-4 XBRL)</h1>
        <nav className="ml-4 flex gap-1">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              disabled={i > 0 && !canLeaveFirst}
              onClick={() => setStep(s.id)}
              className={cn('rounded px-2.5 py-1 text-xs disabled:opacity-40', s.id === step ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-panel-2 hover:text-fg')}
            >
              {s.title}
            </button>
          ))}
        </nav>
        <div className="ml-auto text-xs text-muted" aria-live="polite">
          {busy && (
            <>
              {busy}
              {progress && ` ${progress.done} / ${progress.total}`}
            </>
          )}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto">
        {step === 'financials' && <FinancialsStep />}
        {step === 'tagging' && <TaggingStep />}
        {step === 'masters' && <MastersStep />}
        {step === 'generate' && <GenerateStep />}
      </main>

      <footer className="flex justify-between border-t border-border px-4 py-2">
        <Button disabled={at === 0} onClick={() => setStep(STEPS[at - 1].id)}>
          <ArrowLeft size={14} /> Back
        </Button>
        {at < STEPS.length - 1 && (
          <Button variant="primary" disabled={!canLeaveFirst || !!busy} onClick={() => setStep(STEPS[at + 1].id)}>
            Next <ArrowRight size={14} />
          </Button>
        )}
      </footer>
    </div>
  )
}
