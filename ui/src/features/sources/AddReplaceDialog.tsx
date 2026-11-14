import { Plus, Replace } from 'lucide-react'
import { formatIndian } from '@xap/engine/basics'
import { sourcesText } from '@shared/editor'
import { Button, Dialog } from '@/components/ui/primitives'
import { useSources } from '@/stores/sources'

/**
 * Add / Replace / Cancel (docs/14 Step 3): the fact a tag would write already has a value. Add makes the cell one more
 * source of the figure (summed); Replace tags the cell in place of the current value.
 */
export function AddReplaceDialog() {
  const { conflict: c, answer } = useSources()
  return (
    <Dialog
      open={!!c}
      onClose={() => answer(null)}
      title="This line already has a value"
      width={480}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => answer(null)} data-testid="tag-cancel">
            Cancel
          </Button>
          <Button variant="ghost" onClick={() => answer('replace')} data-testid="tag-replace">
            <Replace size={14} /> Replace
          </Button>
          <Button onClick={() => answer('add')} disabled={!!c?.addBlocked} title={c?.addBlocked ?? 'Add the cell to the figure (summed)'} data-testid="tag-add">
            <Plus size={14} /> Add
          </Button>
        </div>
      }
    >
      {c && (
        <div className="flex flex-col gap-2 text-xs" data-testid="add-replace-dialog">
          <p>
            <span className="font-semibold">{c.conceptLabel}</span> ({c.scope}) is{' '}
            <span className="tabular font-semibold">{formatIndian(c.value)}</span>
            {c.sources.length ? (
              <>
                {' '}
                from <span className="font-mono">{sourcesText(c.sources)}</span>.
              </>
            ) : (
              ' (typed or imported, not from Excel).'
            )}
          </p>
          <p className="text-muted">
            <b>Add</b> sums the selected cell with the current source{c.sources.length > 1 ? 's' : ''}; <b>Replace</b> files the selected cell instead.
          </p>
          {c.addBlocked && <p className="text-warn">{c.addBlocked}</p>}
        </div>
      )}
    </Dialog>
  )
}
