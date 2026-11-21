import { AlertTriangle, CheckCircle2, FileCode2, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/primitives'
import { useIndas } from '@/stores/indas'
import { readinessProblems } from './model'

/** Step 4: check readiness, then /generateXML validates (MCA rules from the KB) and writes the XML. */
export function GenerateStep() {
  const s = useIndas()
  const problems = readinessProblems({ rows: s.rows, meta: s.meta, signatories: s.signatories, companyFields: s.fields?.company ?? [], company: s.company })
  const tagged = s.rows.filter((r) => r.concept).length
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
      <section className="rounded-md border border-border bg-panel p-4 text-xs">
        <div className="grid grid-cols-2 gap-1 text-muted">
          <span>Statement lines tagged</span>
          <span className="text-fg">{tagged}</span>
          <span>Signatories</span>
          <span className="text-fg">{s.signatories.length}</span>
          <span>Period</span>
          <span className="text-fg">
            {s.meta.startDate} → {s.meta.endDate} ({s.meta.nature})
          </span>
        </div>
      </section>

      {problems.length > 0 && (
        <section className="rounded-md border border-warn/50 bg-warn/5 p-3 text-xs">
          <div className="mb-1 flex items-center gap-1.5 font-semibold text-warn">
            <AlertTriangle size={14} /> Before generating
          </div>
          <ul className="list-disc pl-5">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      )}

      <Button variant="primary" className="self-start" disabled={!!s.busy} onClick={() => void s.generate()} data-testid="indas-generate">
        <FileCode2 size={14} /> Validate & generate XML
      </Button>

      {s.result?.ok === true && (
        <section className="rounded-md border border-ok/50 bg-ok/5 p-3 text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-ok">
            <CheckCircle2 size={14} /> XML generated ({s.result.sizeKb} KB)
          </div>
          <div className="mt-1 break-all text-muted">{s.result.path}</div>
          <Button className="mt-2" onClick={() => void window.xap.indas.showGenerated()}>
            <FolderOpen size={14} /> Show in folder
          </Button>
        </section>
      )}

      {s.result?.ok === false && (
        <section className="rounded-md border border-err/50 bg-err/5 p-3 text-xs" data-testid="indas-errors">
          <div className="mb-1 font-semibold text-err">The MCA checks found {s.result.errors.length} problem(s)</div>
          <ul className="flex flex-col gap-1">
            {s.result.errors.map((e, i) => (
              <li key={i}>
                {e.type && <span className="mr-1.5 rounded bg-err/10 px-1 font-mono text-[10px] text-err">{e.type}</span>}
                {e.message}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
