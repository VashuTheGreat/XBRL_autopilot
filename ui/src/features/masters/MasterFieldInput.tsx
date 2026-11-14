import { TriangleAlert } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { fieldProblems, type MasterFieldView, type PanPairView } from '@shared/masters'
import { Input, Select } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'

/**
 * One master field: the input its data type calls for (Yes/No, date, a strict list, a list of suggestions, text),
 * with the live format / list / PAN checks as the user types. Writes on a choice, Enter or leaving the field.
 */
export function MasterFieldInput(props: {
  field: MasterFieldView
  /** the record's current values (the row or the card), for the PAN ↔ name check */
  values: Record<string, string>
  pairs: PanPairView[]
  /** a name the PAN check reads: reminds to type it exactly as on the PAN */
  panName?: boolean
  onWrite(value: string): void
}) {
  const { field } = props
  const saved = props.values[field.concept] ?? ''
  const [text, setText] = useState(saved)
  useEffect(() => setText(saved), [saved])
  const listId = useId()
  const problems = fieldProblems(field, { ...props.values, [field.concept]: text }, props.pairs)
  const write = (value: string) => value !== saved && props.onWrite(value)
  const common = { 'aria-label': field.label, 'data-concept': field.concept, className: cn('h-6 w-full text-[11px]', problems.length && 'border-err') }

  let input
  if (field.dataType === 'boolean' || (field.strictOptions && field.options)) {
    const options = field.dataType === 'boolean' ? [['true', 'Yes'], ['false', 'No']] : field.options!.map((o) => [o, o])
    input = (
      <Select {...common} value={text} onChange={(e) => (setText(e.target.value), write(e.target.value))}>
        <option value="">—</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
    )
  } else if (field.dataType === 'date') {
    input = <Input {...common} type="date" value={text} onChange={(e) => (setText(e.target.value), write(e.target.value))} />
  } else {
    input = (
      <>
        <Input {...common} value={text} list={field.options ? listId : undefined} onChange={(e) => setText(e.target.value)} onBlur={() => write(text)} onKeyDown={(e) => e.key === 'Enter' && write(text)} />
        {field.options && (
          <datalist id={listId}>
            {field.options.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        )}
      </>
    )
  }

  return (
    <label className="flex flex-col gap-0.5 text-[11px]" title={field.concept}>
      <span className="text-muted">{field.label}</span>
      {input}
      {props.panName && <span className="text-[10px] text-warn">Enter it exactly as on the PAN (“&amp; Co.” is not “and Company”).</span>}
      {problems.map((p) => (
        <span key={p} className="flex items-start gap-1 text-[10px] text-err" data-testid="master-problem">
          <TriangleAlert size={10} className="mt-0.5 shrink-0" /> {p}
        </span>
      ))}
    </label>
  )
}
