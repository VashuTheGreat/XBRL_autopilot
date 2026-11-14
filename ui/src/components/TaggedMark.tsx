import { Check } from 'lucide-react'
import type { ConceptUse } from '@shared/editor'
import { cn } from '@/lib/cn'

/**
 * On a taxonomy search result: a tick and "tagged at Balance Sheet!C14 (CY)" (+ n more) when the element is already
 * tagged, so a used element is obvious before it is tagged twice. The tooltip lists every cell.
 */
export function TaggedMark(props: { uses: ConceptUse[] | undefined; className?: string }) {
  const uses = props.uses
  if (!uses?.length) return null
  const more = uses.length - 1
  return (
    <span
      className={cn('inline-flex items-center gap-0.5 rounded bg-ok/15 px-1 text-[10px] text-ok', props.className)}
      title={`Already tagged at:\n${uses.map((u) => u.text).join('\n')}`}
      data-testid="tagged-mark"
    >
      <Check size={10} />
      tagged at {uses[0]!.text}
      {more > 0 && ` +${more}`}
    </span>
  )
}
