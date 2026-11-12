/**
 * "Also report as" (ADR-0013): the tagged cell's figure filed as one more fact — the same element (or another line
 * item of a table) with members, e.g. Equity share capital also as its class "Equity shares 1". The fact follows the
 * cell from then on and goes when the cell is untagged.
 */
import { Link2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { DimRef, Scope, TableInfo, TableStructure } from '@shared/editor'
import { Button, Dialog, Field, Select } from '@/components/ui/primitives'
import { useEditor } from '@/stores/editor'
import { useTables } from '@/stores/tables'
import { MemberChips, roleSuffix, rowKey, TablePicker } from './pickers'

export function AlsoReportDialog({ mappingId, concept, onClose }: { mappingId: string; concept: string; onClose(): void }) {
  const loadStructure = useTables((s) => s.structure)
  const addAlso = useEditor((s) => s.addAlso)
  const [tableId, setTableId] = useState<string | null>(null)
  const [structure, setStructure] = useState<TableStructure | null>(null)
  const [item, setItem] = useState('')
  const [members, setMembers] = useState<DimRef[]>([])
  const [scope, setScope] = useState<Scope | ''>('')
  const [busy, setBusy] = useState(false)
  const reportsElement = useCallback((t: TableInfo) => t.concepts.includes(concept), [concept])

  useEffect(() => {
    if (!tableId) return
    void loadStructure(tableId).then((s) => {
      setStructure(s)
      setMembers([])
      // the cell's own element first: the same figure with members is the usual case
      const own = s?.lineItems.find((l) => !l.abstract && l.concept === concept && l.preferredLabel !== 'periodStartLabel')
      setItem(own ? rowKey(own.concept, own.preferredLabel) : '')
    })
  }, [tableId, loadStructure, concept])

  const submit = async () => {
    const [q, role] = item.split('|')
    if (!q || !tableId) return
    setBusy(true)
    const ok = await addAlso({ mappingId, concept: q, dims: members, tableId, preferredLabel: role || null, ...(scope ? { scope } : {}) })
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Dialog
      open
      title="Also report this figure as…"
      onClose={onClose}
      width={640}
      footer={
        <Button variant="primary" disabled={!item || !members.length || busy} onClick={() => void submit()} data-testid="also-submit">
          <Link2 size={13} /> Also report
        </Button>
      }
    >
      <div className="flex flex-col gap-3 text-xs" data-testid="also-dialog">
        <p className="text-muted">Tables that report this cell’s element are marked ★ and listed first.</p>
        <TablePicker value={tableId} onPick={setTableId} prefer={reportsElement} />
        {structure && (
          <>
            <Field label="Line item">
              <Select value={item} onChange={(e) => setItem(e.target.value)} aria-label="Line item">
                <option value="">— choose —</option>
                {structure.lineItems
                  .filter((l) => !l.abstract)
                  .map((l) => (
                    <option key={rowKey(l.concept, l.preferredLabel)} value={rowKey(l.concept, l.preferredLabel)}>
                      {l.label}
                      {roleSuffix(l.preferredLabel)}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Members" hint="At least one: the column of the table this figure belongs to.">
              <MemberChips structure={structure} value={members} onChange={setMembers} testId="also-members" />
            </Field>
            <Field label="Year">
              <Select value={scope} onChange={(e) => setScope(e.target.value as Scope | '')} aria-label="Year">
                <option value="">Same as the cell’s tag</option>
                <option value="CY">CY</option>
                <option value="PY">PY</option>
              </Select>
            </Field>
          </>
        )}
      </div>
    </Dialog>
  )
}
