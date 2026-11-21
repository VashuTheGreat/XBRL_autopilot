import { Plus, Trash2 } from 'lucide-react'
import type { MasterField } from '@shared/indas'
import { Button, Field, Input, Select } from '@/components/ui/primitives'
import { useIndas } from '@/stores/indas'
import { fieldKind } from './model'

/** Step 3: filing settings, the mandatory company and auditor fields (from the KB), and the signatories. */
export function MastersStep() {
  const { fields, meta, setMeta, company, setCompany, auditor, setAuditor, signatories, addSignatory, updateSignatory, removeSignatory } = useIndas()
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-6">
      <Card title="Filing">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Nature of report">
            <Select value={meta.nature} onChange={(e) => setMeta({ nature: e.target.value as 'Standalone' | 'Consolidated' })}>
              <option>Standalone</option>
              <option>Consolidated</option>
            </Select>
          </Field>
          <Field label="Financial year start">
            <Input type="date" value={meta.startDate} onChange={(e) => setMeta({ startDate: e.target.value })} />
          </Field>
          <Field label="Financial year end">
            <Input type="date" value={meta.endDate} onChange={(e) => setMeta({ endDate: e.target.value })} />
          </Field>
        </div>
      </Card>

      {!fields ? (
        <p className="text-center text-xs text-muted">Loading the mandatory fields…</p>
      ) : (
        <>
          <Card title="Company (mandatory)">
            <FieldGrid fields={fields.company} values={company} onChange={setCompany} />
          </Card>
          <Card title="Auditor's report (mandatory)">
            <FieldGrid fields={fields.auditor} values={auditor} onChange={setAuditor} />
          </Card>
        </>
      )}

      <Card title="Directors signing the financial statements (at least 2)">
        <div className="flex flex-col gap-2">
          {signatories.map((s, i) => (
            <div key={i} className="grid grid-cols-[8rem_1fr_10rem_9rem_auto] items-end gap-2">
              <Field label="DIN">
                <Input value={s.din} inputMode="numeric" maxLength={8} onChange={(e) => updateSignatory(i, { din: e.target.value.replace(/\D/g, '') })} />
              </Field>
              <Field label="Name">
                <Input value={s.name} onChange={(e) => updateSignatory(i, { name: e.target.value })} />
              </Field>
              <Field label="Designation">
                <Input value={s.designation} onChange={(e) => updateSignatory(i, { designation: e.target.value })} />
              </Field>
              <Field label="Signing date">
                <Input type="date" value={s.signingDate ?? ''} onChange={(e) => updateSignatory(i, { signingDate: e.target.value })} />
              </Field>
              <Button variant="ghost" title="Remove" onClick={() => removeSignatory(i)}>
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
          <Button className="self-start" onClick={addSignatory}>
            <Plus size={14} /> Add director
          </Button>
        </div>
      </Card>
    </div>
  )
}

function Card(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-panel">
      <header className="border-b border-border px-3 py-2 text-xs font-semibold">{props.title}</header>
      <div className="p-3">{props.children}</div>
    </section>
  )
}

function FieldGrid(props: { fields: MasterField[]; values: Record<string, string>; onChange(qname: string, value: string): void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {props.fields.map((f) => {
        const v = props.values[f.qname] ?? ''
        const kind = fieldKind(f.type)
        return (
          <Field key={f.qname} label={f.label} hint={f.qname} className={kind === 'longtext' ? 'sm:col-span-2' : undefined}>
            {kind === 'date' ? (
              <Input type="date" value={v} onChange={(e) => props.onChange(f.qname, e.target.value)} />
            ) : kind === 'boolean' ? (
              <Select value={v} onChange={(e) => props.onChange(f.qname, e.target.value)}>
                <option value="">—</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </Select>
            ) : kind === 'longtext' ? (
              <textarea
                className="min-h-20 w-full rounded border border-border bg-panel px-2 py-1 text-[13px] outline-none focus:border-accent"
                value={v}
                onChange={(e) => props.onChange(f.qname, e.target.value)}
              />
            ) : (
              <Input value={v} onChange={(e) => props.onChange(f.qname, e.target.value)} />
            )}
          </Field>
        )
      })}
    </div>
  )
}
