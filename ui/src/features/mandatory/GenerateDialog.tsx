import { CircleAlert, CircleCheck, FileCode2, ListChecks } from 'lucide-react'
import { useEffect, useState } from 'react'
import { generateReadiness, type KeyAnswerView } from '@shared/mandatory'
import { Button, Checkbox, Dialog } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { useMandatory } from '@/stores/mandatory'
import { useProject } from '@/stores/project'
import { useUi } from '@/stores/ui'
import { useValidation } from '@/stores/validation'

/**
 * Generate XML (docs/14 Step 5): confirm the key Yes/No answers (curated in the knowledge base; each decides which
 * other items MCA requires), see what is still empty, and write the instance. Validation errors block: "Fix first"
 * opens Problems, and main refuses to write a filing the gate blocks.
 */
export function GenerateDialog() {
  const { generateOpen, closeGenerate, openList, keyAnswers, view, refresh, generate, generating, set } = useMandatory()
  const errors = useValidation((s) => s.view?.summary.errors ?? 0)
  const revision = useProject((s) => s.summary?.revision)
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => void refresh(), [revision, refresh])
  useEffect(() => {
    if (!generateOpen) return
    setConfirmed(false)
    void useValidation.getState().run()
  }, [generateOpen])

  const r = generateReadiness({ keyAnswers, confirmed, errors, mandatory: view })
  const fixFirst = () => {
    closeGenerate()
    useUi.getState().setBottomTab('problems')
  }

  return (
    <Dialog
      open={generateOpen}
      onClose={closeGenerate}
      title="Generate XML"
      width={640}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          {r.errors > 0 && (
            <Button variant="ghost" onClick={fixFirst} data-testid="generate-fix-first">
              Fix first
            </Button>
          )}
          <Button onClick={() => void generate()} disabled={!r.ready || generating} data-testid="generate-xml">
            <FileCode2 size={14} /> {generating ? 'Generating…' : 'Generate'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-xs" data-testid="generate-dialog">
        <section>
          <h3 className="mb-1.5 font-semibold">Confirm the key answers</h3>
          <p className="mb-2 text-muted">Each answer decides which other items MCA requires. A wrong one silently opens or closes whole disclosures.</p>
          <ul className="rounded border border-border">
            {keyAnswers.map((k) => (
              <KeyAnswerRow key={k.concept} answer={k} onAnswer={(v) => void set({ concept: k.concept, scope: 'CY', value: String(v) })} />
            ))}
          </ul>
          <div className="mt-2">
            <Checkbox checked={confirmed} onChange={setConfirmed} label="These answers are correct for this filing" disabled={r.unanswered.length > 0} />
          </div>
        </section>

        <Status ok={r.pending === 0} testId="generate-pending">
          {r.pending === 0 ? (
            'Nothing mandatory is left empty.'
          ) : (
            <>
              {r.pending} mandatory item{r.pending === 1 ? '' : 's'} still empty.{' '}
              <button className="text-accent underline" onClick={openList}>
                <ListChecks size={12} className="mr-0.5 inline" />
                Review…
              </button>
            </>
          )}
        </Status>
        <Status ok={r.errors === 0} testId="generate-errors">
          {r.errors === 0 ? 'No validation errors.' : `${r.errors} validation error${r.errors === 1 ? '' : 's'}: fix them first (Problems panel).`}
        </Status>
      </div>
    </Dialog>
  )
}

function KeyAnswerRow(props: { answer: KeyAnswerView; onAnswer(v: boolean): void }) {
  const k = props.answer
  const opens = k.decides.length ? `${k.requiredWhen ? 'Yes' : 'No'} requires: ${k.decides.join('; ')}` : ''
  return (
    <li className="flex items-center gap-3 border-b border-border/50 px-3 py-1.5 last:border-0" title={[k.concept, opens, k.rules.join(', ')].filter(Boolean).join('\n')} data-testid="key-answer" data-concept={k.concept}>
      <span className={cn('flex-1', k.value === null && 'text-err')}>{k.label}</span>
      <span className="flex shrink-0 gap-1">
        {[true, false].map((v) => (
          <Button key={String(v)} variant="ghost" className={cn('h-6 border px-2 text-[11px]', k.value === v ? 'border-accent bg-accent/15 text-accent' : 'border-border')} onClick={() => props.onAnswer(v)} aria-pressed={k.value === v}>
            {v ? 'Yes' : 'No'}
          </Button>
        ))}
      </span>
    </li>
  )
}

function Status(props: { ok: boolean; testId: string; children: React.ReactNode }) {
  const Icon = props.ok ? CircleCheck : CircleAlert
  return (
    <p className={cn('flex items-center gap-1.5', props.ok ? 'text-ok' : 'text-warn')} data-testid={props.testId}>
      <Icon size={14} className="shrink-0" /> <span>{props.children}</span>
    </p>
  )
}
