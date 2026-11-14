import { CircleCheck, Table2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { groupByStatement, inputKind, type MandatoryItemView, type RequiredTableView } from '@shared/mandatory'
import { Button, Dialog, Input, Select } from '@/components/ui/primitives'
import { cn } from '@/lib/cn'
import { useEditor } from '@/stores/editor'
import { useMandatory } from '@/stores/mandatory'
import { useProject } from '@/stores/project'

/**
 * Mandatory items still empty (docs/14 Step 5): the text / date / Yes-No items and the tables the MCA rules require
 * now, grouped by statement, with inline inputs. Amounts are left to "Empty mandatory → 0". Double-click an item to
 * show it in the Form.
 */
export function MandatoryDialog() {
  const { listOpen, closeList, view, refresh } = useMandatory()
  const revision = useProject((s) => s.summary?.revision)
  useEffect(() => void refresh(), [revision, refresh])

  const show = (target: { elrUri: string; concept: string; tableId?: string }) => {
    closeList()
    useMandatory.getState().closeGenerate()
    void useEditor.getState().showInForm(target)
  }
  const groups = groupByStatement<MandatoryItemView | RequiredTableView>([...(view?.items ?? []), ...(view?.tables ?? [])])

  return (
    <Dialog open={listOpen} onClose={closeList} title="Mandatory items still empty" width={760}>
      <div className="flex flex-col gap-3 text-xs" data-testid="mandatory-dialog">
        <p className="text-muted">
          Text, date and Yes/No items the MCA rules require for this filing, per year. A Yes/No answer can open or close other items. Amounts are reported with “Empty mandatory → 0” on each statement. Double-click an item to show it in the Form.
        </p>
        {!view ? (
          <p className="text-muted">Loading…</p>
        ) : !groups.length ? (
          <p className="flex items-center gap-1.5 text-ok">
            <CircleCheck size={14} /> Nothing mandatory is left empty.
          </p>
        ) : (
          groups.map((g) => (
            <section key={g.elrUri} className="rounded border border-border">
              <h3 className="border-b border-border bg-panel-2 px-3 py-1.5 text-[11px] font-semibold">{g.title}</h3>
              <ul>
                {g.rows.map((r) => ('tableId' in r ? <TableRow key={`${r.tableId}|${r.scope}`} table={r} onShow={() => show({ elrUri: r.elrUri, concept: '', tableId: r.tableId })} /> : <ItemRow key={`${r.concept}|${r.scope}`} item={r} onShow={() => show({ elrUri: r.elrUri, concept: r.concept })} />))}
              </ul>
            </section>
          ))
        )}
      </div>
    </Dialog>
  )
}

function ItemRow(props: { item: MandatoryItemView; onShow(): void }) {
  const { item } = props
  return (
    <li className="flex items-start gap-3 border-b border-border/50 px-3 py-1.5 last:border-0 hover:bg-panel-2" onDoubleClick={props.onShow} data-testid="mandatory-item" data-concept={item.concept}>
      <div className="min-w-0 flex-1" title={`${item.concept}\n${item.reasons.join('\n')}\nDouble-click to show it in the Form`}>
        <span>{item.label}</span> <span className="rounded bg-panel-2 px-1 text-[10px] text-muted">{item.scope}</span>
        {item.conditional && <span className="ml-1 text-[10px] text-warn">required by another answer</span>}
      </div>
      <ItemInput item={item} />
    </li>
  )
}

/** The input for the item's data type; it writes on a Yes/No click, a list choice, a date, or Enter / leaving a text. */
function ItemInput({ item }: { item: MandatoryItemView }) {
  const save = useMandatory((s) => s.set)
  const [text, setText] = useState('')
  const write = (value: string) => value.trim() && void save({ concept: item.concept, scope: item.scope, value })
  const kind = inputKind(item)
  if (kind === 'yesNo') {
    return (
      <span className="flex shrink-0 gap-1">
        {(['true', 'false'] as const).map((v) => (
          <Button key={v} variant="ghost" className="h-6 border border-border px-2 text-[11px]" onClick={() => write(v)}>
            {v === 'true' ? 'Yes' : 'No'}
          </Button>
        ))}
      </span>
    )
  }
  if (kind === 'list') {
    return (
      <Select className="h-6 w-56 shrink-0 text-[11px]" value="" onChange={(e) => write(e.target.value)} aria-label={item.label}>
        <option value="">Choose…</option>
        {item.enumerations!.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </Select>
    )
  }
  if (kind === 'date') return <Input type="date" className="h-6 w-40 shrink-0 text-[11px]" onChange={(e) => write(e.target.value)} aria-label={item.label} />
  const common = {
    value: text,
    placeholder: kind === 'textBlock' ? 'Text (Enter on a new line: Ctrl+Enter to save)' : 'Type and press Enter',
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    onBlur: () => write(text),
    'aria-label': item.label,
  }
  return kind === 'textBlock' ? (
    <textarea {...common} rows={2} className={cn('w-72 shrink-0 rounded border border-border bg-panel px-2 py-1 text-[11px] outline-none focus:border-accent select-text')} onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && write(text)} />
  ) : (
    <Input {...common} className="h-6 w-72 shrink-0 text-[11px]" onKeyDown={(e) => e.key === 'Enter' && write(text)} />
  )
}

function TableRow(props: { table: RequiredTableView; onShow(): void }) {
  const { table: t } = props
  return (
    <li className="flex items-center gap-3 border-b border-border/50 px-3 py-1.5 last:border-0 hover:bg-panel-2" onDoubleClick={props.onShow} title={`${t.reason} (${t.ruleId})\nDouble-click to open the table`} data-testid="mandatory-table">
      <Table2 size={12} className="shrink-0 text-accent" />
      <span className="flex-1">
        {t.title} <span className="rounded bg-panel-2 px-1 text-[10px] text-muted">{t.scope}</span> <span className="text-[10px] text-warn">table required by another answer</span>
      </span>
      <Button variant="ghost" className="h-6 px-2 text-[11px]" onClick={props.onShow}>
        Open table
      </Button>
    </li>
  )
}
