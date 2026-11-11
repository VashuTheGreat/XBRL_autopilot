/**
 * "Map as table" (ADR-0013): a dragged range → one taxonomy table. Each row of the range with figures gets a line item
 * (with opening / closing role), an optional year and members; each column with figures gets members and an optional
 * year. Preview shows what would be filed, cell by cell; Map tags the ready cells as one block.
 */
import { Eye, Table2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { DimRef, Scope, TableBlockInput, TableBlockPlan, TableStructure } from '@shared/editor'
import { columnLetter, rangeOf, type CellModel, type CellRef } from '@shared/workbook'
import { Button, Dialog, Select } from '@/components/ui/primitives'
import { useEditor } from '@/stores/editor'
import { useTables } from '@/stores/tables'
import { MemberChips, roleSuffix, rowKey, TablePicker } from './pickers'

interface RowChoice {
  key: string // "concept|role", '' = skip
  scope: Scope | ''
  members: DimRef[]
}
interface ColChoice {
  scope: Scope | ''
  members: DimRef[]
}

export function TableMapDialog({ range, onClose }: { range: CellRef; onClose(): void }) {
  const workbooks = useEditor((s) => s.workbooks)
  const { structure: loadStructure, plan: planTable, apply } = useTables()
  const [tableId, setTableId] = useState<string | null>(null)
  const [structure, setStructure] = useState<TableStructure | null>(null)
  const [rows, setRows] = useState<Record<number, RowChoice>>({})
  const [cols, setCols] = useState<Record<number, ColChoice>>({})
  const [plan, setPlan] = useState<TableBlockPlan | null>(null)
  const [busy, setBusy] = useState(false)

  const layout = useMemo(() => blockLayout(workbooks.find((w) => w.source === range.workbook)?.sheets.find((s) => s.name === range.sheet)?.cells ?? [], range), [workbooks, range])

  useEffect(() => {
    if (!tableId) return
    void loadStructure(tableId).then((s) => {
      setStructure(s)
      setRows({})
      setCols({})
      setPlan(null)
    })
  }, [tableId, loadStructure])

  const lineItems = (structure?.lineItems ?? []).filter((l) => !l.abstract)
  const input = (): TableBlockInput | null => {
    if (!tableId) return null
    const chosen = layout.rows
      .map((r) => ({ r: r.r, c: rows[r.r] }))
      .filter((x) => x.c?.key)
      .map(({ r, c }) => {
        const [concept, role] = c!.key.split('|')
        return { r, concept: concept!, preferredLabel: role || null, ...(c!.scope ? { scope: c!.scope } : {}), members: c!.members }
      })
    if (!chosen.length) return null
    return {
      cell: range,
      tableId,
      rows: chosen,
      cols: layout.cols.map((c) => ({ c: c.c, ...(cols[c.c]?.scope ? { scope: cols[c.c]!.scope as Scope } : {}), members: cols[c.c]?.members ?? [] })),
    }
  }
  const ready = !!input()

  const preview = async () => {
    const i = input()
    if (!i) return
    setBusy(true)
    setPlan(await planTable(i))
    setBusy(false)
  }
  const map = async () => {
    const i = input()
    if (!i) return
    setBusy(true)
    const r = await apply(i)
    setBusy(false)
    if (r?.tagged) onClose()
  }
  const setRow = (r: number, patch: Partial<RowChoice>) => {
    setRows((s) => ({ ...s, [r]: { ...(s[r] ?? { key: '', scope: '', members: [] }), ...patch } }))
    setPlan(null)
  }
  const setCol = (c: number, patch: Partial<ColChoice>) => {
    setCols((s) => ({ ...s, [c]: { ...(s[c] ?? { scope: '', members: [] }), ...patch } }))
    setPlan(null)
  }

  return (
    <Dialog
      open
      title={`Map ${range.sheet}!${range.ref} as a table`}
      onClose={onClose}
      width={920}
      footer={
        <>
          <span className="mr-auto self-center text-[11px] text-muted">
            {plan ? `${plan.ready} cells ready, ${plan.blocked} with problems` : 'Rows without a line item are skipped. A blank cell gives no fact; a 0 gives 0.'}
          </span>
          <Button disabled={!ready || busy} onClick={() => void preview()} data-testid="table-preview">
            <Eye size={13} /> Preview
          </Button>
          <Button variant="primary" disabled={!ready || busy} onClick={() => void map()} data-testid="table-apply">
            <Table2 size={13} /> Map cells
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-xs" data-testid="table-map-dialog">
        <TablePicker value={tableId} onPick={setTableId} />
        {structure && (
          <>
            <section>
              <h3 className="mb-1 font-semibold">Columns</h3>
              <div className="grid grid-cols-[6rem_1fr_6rem] items-center gap-x-2 gap-y-1">
                {layout.cols.map((c) => (
                  <ColumnRow key={c.c} c={c} structure={structure} choice={cols[c.c]} onChange={(p) => setCol(c.c, p)} />
                ))}
              </div>
            </section>
            <section>
              <h3 className="mb-1 font-semibold">Rows</h3>
              <div className="grid grid-cols-[minmax(8rem,14rem)_minmax(10rem,1fr)_5rem_minmax(8rem,1fr)] items-center gap-x-2 gap-y-1">
                {layout.rows.map((r) => (
                  <div key={r.r} className="contents" data-testid="table-map-row" data-row={r.r}>
                    <span className="truncate text-muted" title={r.label}>
                      {r.r + 1}. {r.label || '—'}
                    </span>
                    <Select className="h-7 text-[12px]" value={rows[r.r]?.key ?? ''} onChange={(e) => setRow(r.r, { key: e.target.value })} aria-label={`Line item of row ${r.r + 1}`}>
                      <option value="">— skip —</option>
                      {lineItems.map((l) => (
                        <option key={rowKey(l.concept, l.preferredLabel)} value={rowKey(l.concept, l.preferredLabel)} title={l.concept}>
                          {' '.repeat(Math.max(0, l.depth - 1) * 2)}
                          {l.label}
                          {roleSuffix(l.preferredLabel)}
                        </option>
                      ))}
                    </Select>
                    <ScopeSelect value={rows[r.r]?.scope ?? ''} onChange={(s) => setRow(r.r, { scope: s })} label={`Year of row ${r.r + 1}`} />
                    <MemberChips structure={structure} value={rows[r.r]?.members ?? []} onChange={(m) => setRow(r.r, { members: m })} />
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
        {plan && plan.blocked > 0 && (
          <section data-testid="table-plan-problems">
            <h3 className="mb-1 font-semibold text-warn">Cells that won’t be tagged</h3>
            <ul className="max-h-32 overflow-auto font-mono text-[11px]">
              {plan.cells
                .filter((c) => c.problems.length)
                .slice(0, 50)
                .map((c) => (
                  <li key={c.cell.ref}>
                    {c.cell.ref}: {c.problems.join(' ')}
                  </li>
                ))}
            </ul>
          </section>
        )}
      </div>
    </Dialog>
  )
}

function ColumnRow(props: { c: { c: number; label: string }; structure: TableStructure; choice: ColChoice | undefined; onChange(p: Partial<ColChoice>): void }) {
  const { c } = props
  return (
    <div className="contents" data-testid="table-map-col" data-col={c.c}>
      <span className="truncate text-muted" title={c.label}>
        {columnLetter(c.c)} {c.label}
      </span>
      <MemberChips structure={props.structure} value={props.choice?.members ?? []} onChange={(m) => props.onChange({ members: m })} />
      <ScopeSelect value={props.choice?.scope ?? ''} onChange={(s) => props.onChange({ scope: s })} label={`Year of column ${columnLetter(c.c)}`} />
    </div>
  )
}

function ScopeSelect(props: { value: Scope | ''; onChange(s: Scope | ''): void; label: string }) {
  return (
    <Select className="h-7 text-[12px]" value={props.value} onChange={(e) => props.onChange(e.target.value as Scope | '')} aria-label={props.label}>
      <option value="">year: auto</option>
      <option value="CY">CY</option>
      <option value="PY">PY</option>
    </Select>
  )
}

/** The block's rows and columns that hold figures, with the text that labels them (row: leftmost text; column: header above). */
export function blockLayout(cells: CellModel[], range: CellRef): { rows: { r: number; label: string }[]; cols: { c: number; label: string }[] } {
  const g = rangeOf(range.ref)
  if (!g) return { rows: [], cols: [] }
  const inside = cells.filter((x) => x.r >= g.r1 && x.r <= g.r2 && x.c >= g.c1 && x.c <= g.c2)
  const numeric = inside.filter((x) => typeof x.v === 'number')
  const colSet = [...new Set(numeric.map((x) => x.c))].sort((a, b) => a - b)
  const rowSet = [...new Set(numeric.map((x) => x.r))].sort((a, b) => a - b)
  const firstValueCol = colSet[0] ?? g.c2
  const text = (x: CellModel) => typeof x.v === 'string' && x.v.trim() !== ''
  const rows = rowSet.map((r) => {
    const t = cells.filter((x) => x.r === r && x.c < firstValueCol && text(x)).sort((a, b) => a.c - b.c)[0]
    return { r, label: t ? String(t.v).trim() : '' }
  })
  const firstValueRow = rowSet[0] ?? g.r1
  const cols = colSet.map((c) => {
    const t = cells.filter((x) => x.c === c && x.r < firstValueRow && x.r >= firstValueRow - 4 && text(x)).sort((a, b) => b.r - a.r)[0]
    return { c, label: t ? String(t.v).trim() : '' }
  })
  return { rows, cols }
}
