import { CheckCheck, Sparkles } from 'lucide-react'
import { TAGGED_STATEMENTS } from '@shared/indas'
import { Button, Input } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { useIndas } from '@/stores/indas'
import { formatAmount, type TagRow } from './model'

/** Step 2: AI suggests a concept per statement line; the user accepts or picks one (AI only proposes). */
export function TaggingStep() {
  const { rows, suggest, acceptTop, busy } = useIndas()
  const tagged = rows.filter((r) => r.concept).length
  const suggested = rows.some((r) => r.suggestions.length > 0)
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={!!busy || rows.length === 0} onClick={() => void suggest()} data-testid="indas-suggest">
          <Sparkles size={14} /> Suggest tags
        </Button>
        <Button disabled={!!busy || !suggested} onClick={acceptTop} title="Accept the first suggestion on every line you haven't tagged">
          <CheckCheck size={14} /> Accept top suggestions
        </Button>
        <span className="ml-auto text-xs text-muted">
          {tagged} of {rows.length} lines tagged
        </span>
      </div>
      {TAGGED_STATEMENTS.map((st) => {
        const lines = rows.filter((r) => r.statement === st.key)
        return (
          <section key={st.key} className="rounded-md border border-border bg-panel">
            <header className="border-b border-border px-3 py-2 text-xs font-semibold">
              {st.title} <span className="font-normal text-muted">({lines.length} lines)</span>
            </header>
            {lines.length === 0 ? (
              <p className="p-4 text-center text-xs text-muted">No lines with amounts.</p>
            ) : (
              <table className="w-full text-[12px]">
                <thead className="bg-panel-2 text-left text-muted">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Line item</th>
                    <th className="w-12 px-2 py-1.5 font-medium">Note</th>
                    <th className="w-32 px-2 py-1.5 text-right font-medium">Current year</th>
                    <th className="w-32 px-2 py-1.5 text-right font-medium">Previous year</th>
                    <th className="w-[34%] px-2 py-1.5 font-medium">XBRL concept</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((r) => (
                    <TagLine key={r.id} row={r} />
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )
      })}
    </div>
  )
}

function TagLine({ row }: { row: TagRow }) {
  const setConcept = useIndas((s) => s.setConcept)
  const known = row.suggestions.some((s) => s.qname === row.concept)
  return (
    <tr className={cn('border-t border-border/60', !row.concept && 'bg-warn/5')}>
      <td className="px-2 py-1">
        <div>{row.label}</div>
        {row.breadcrumb && row.breadcrumb !== row.label && <div className="text-[11px] text-muted">{row.breadcrumb}</div>}
      </td>
      <td className="px-2 py-1 text-muted">{row.note}</td>
      <td className="px-2 py-1 text-right font-mono tabular-nums">{formatAmount(row.cy)}</td>
      <td className="px-2 py-1 text-right font-mono tabular-nums">{formatAmount(row.py)}</td>
      <td className="px-2 py-1">
        <div className="flex flex-col gap-1">
          <select
            className="h-7 w-full rounded border border-border bg-panel px-1.5 text-[12px]"
            value={known ? row.concept : row.concept ? '__other' : ''}
            onChange={(e) => e.target.value !== '__other' && setConcept(row.id, e.target.value)}
            aria-label={`Concept for ${row.label}`}
          >
            <option value="">{row.suggestions.length ? '— choose a suggestion —' : '— not tagged —'}</option>
            {row.suggestions.map((s) => (
              <option key={s.qname} value={s.qname}>
                {s.label} · {s.qname} ({Math.round(s.score * 100)}%)
              </option>
            ))}
            {row.concept && !known && <option value="__other">{row.concept}</option>}
          </select>
          <Input
            className="h-7 font-mono text-[11px]"
            placeholder="or type a concept, e.g. ind-as:Inventories"
            value={known ? '' : row.concept}
            onChange={(e) => setConcept(row.id, e.target.value.trim())}
          />
        </div>
      </td>
    </tr>
  )
}
