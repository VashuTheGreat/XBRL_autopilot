import { CheckCircle2, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { taxonomyLabel } from '@xap/engine/basics'
import type { ImportReportView, InstanceConventionsView } from '@shared/project'
import { Button, Dialog, Section } from '@/components/ui/primitives'
import { useProject } from '@/stores/project'

const n = (v: number) => v.toLocaleString('en-IN')

/** What an XBRL instance import did: counts, the round-trip proof and the vendor conventions (Phase 7). */
export function ImportReportDialog() {
  const { importReport: r, closeImportReport } = useProject()
  if (!r) return null
  return (
    <Dialog
      open
      title={`Imported ${r.fileName}`}
      onClose={closeImportReport}
      width={720}
      footer={
        <Button variant="primary" onClick={closeImportReport}>
          Close
        </Button>
      }
    >
      <div className="flex max-h-[65vh] flex-col gap-5 overflow-y-auto pr-1 text-[12px]" data-testid="import-report">
        <Section title="Summary">
          <Grid
            rows={[
              ['Taxonomy', taxonomyLabel(r.taxonomy)],
              ['Mode', r.mode === 'next' ? "Next year's filing (this file's current year → previous year)" : 'The filing as filed'],
              ['Current year', `${r.periods.cy.start} → ${r.periods.cy.end}`],
              ['Previous year', r.periods.py ? `${r.periods.py.start} → ${r.periods.py.end}` : '—'],
              ['Facts in file', n(r.counts.sourceFacts)],
              ['Imported', <span data-testid="import-imported">{n(r.counts.imported)}</span>],
              ...(r.counts.skippedPrevious ? ([['Not carried (older year)', n(r.counts.skippedPrevious)]] as [string, ReactNode][]) : []),
              ['Could not import', <span className={r.counts.unresolved ? 'text-err' : ''}>{n(r.counts.unresolved)}</span>],
              ['Footnotes', n(r.counts.footnotes)],
            ]}
          />
        </Section>

        {r.roundTrip && (
          <Section title="Round trip">
            {r.roundTrip.identical ? (
              <p className="flex items-center gap-2 text-ok" data-testid="round-trip-ok">
                <CheckCircle2 size={15} /> All {n(r.roundTrip.sourceFacts)} facts regenerate with the same element, period, dimensions, unit, decimals and value.
              </p>
            ) : (
              <div className="flex flex-col gap-1 text-err" data-testid="round-trip-diff">
                <p className="flex items-center gap-2">
                  <TriangleAlert size={15} /> {n(r.roundTrip.equal)} of {n(r.roundTrip.sourceFacts)} facts regenerate unchanged.
                </p>
                <Listing title="Missing" items={r.roundTrip.missing} />
                <Listing title="Added" items={r.roundTrip.extra} />
                <Listing title="Changed" items={r.roundTrip.changed.map((c) => `${c.key}: ${c.source.join(' / ')} → ${c.regenerated.join(' / ')}`)} />
              </div>
            )}
          </Section>
        )}

        {(r.unresolved.length > 0 || r.warnings.length > 0) && (
          <Section title="Notes">
            <Listing title="Could not import" items={r.unresolved.map((u) => `${u.concept}${u.context ? ` (${u.context})` : ''}: ${u.reason}`)} />
            <Listing title="Warnings" items={r.warnings} />
          </Section>
        )}

        <Section title="Their conventions vs ours (facts unaffected)">
          <Conventions source={r.conventions.source} ours={r.conventions.ours} />
        </Section>
      </div>
    </Dialog>
  )
}

function Grid({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[180px_1fr] gap-x-4 gap-y-1">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function Listing({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null
  return (
    <details className="text-fg">
      <summary className="cursor-pointer">
        {title} ({n(items.length)})
      </summary>
      <ul className="mt-1 max-h-40 overflow-y-auto font-mono text-[11px] text-muted">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </details>
  )
}

function Conventions({ source, ours }: { source: InstanceConventionsView; ours: InstanceConventionsView }) {
  const decimals = (d: Record<string, number>) => Object.entries(d).map(([k, v]) => `${k} ×${n(v)}`).join(', ') || '—'
  const rows: [string, string, string][] = [
    ['Written by', source.generator ?? '—', 'XBRL Autopilot'],
    ['Context ids', `${source.contextIdStyle} (up to ${source.longestContextId} chars)`, `${ours.contextIdStyle} (up to ${ours.longestContextId} chars)`],
    ['Contexts', n(source.contexts), n(ours.contexts)],
    ['Duplicate contexts', n(source.duplicateContexts), n(ours.duplicateContexts)],
    ['Facts with an id', `${n(source.factsWithId)} of ${n(source.facts)}`, `${n(ours.factsWithId)} of ${n(ours.facts)}`],
    ['Units', source.units.join(', '), ours.units.join(', ')],
    ['decimals used', decimals(source.decimals), decimals(ours.decimals)],
    ['Footnotes', n(source.footnotes), n(ours.footnotes)],
  ]
  return (
    <table className="w-full border-collapse" data-testid="conventions">
      <thead>
        <tr className="text-left text-muted">
          <th className="py-1 pr-3 font-normal"></th>
          <th className="py-1 pr-3 font-normal">Their file</th>
          <th className="py-1 font-normal">Ours</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, a, b]) => (
          <tr key={k} className="border-t border-border align-top">
            <td className="py-1 pr-3 text-muted">{k}</td>
            <td className={`py-1 pr-3 ${a !== b ? 'text-warn' : ''}`}>{a}</td>
            <td className="py-1">{b}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
