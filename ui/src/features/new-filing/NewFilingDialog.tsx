import { useEffect, useMemo, useState } from 'react'
import {
  defaultDisplayPlaces,
  defaultReportingYear,
  fyLabel,
  isValidCin,
  maxDisplayPlaces,
  previousYearOf,
  ROUNDING_LEVELS,
  validateFilingPeriods,
  type ReportType,
  type RoundingLevel,
} from '@xap/engine/basics'
import type { NewFilingInput } from '@shared/project'
import { Button, Checkbox, Dialog, Field, Input, Section, Select } from '@/components/ui/primitives'
import { useProject } from '@/stores/project'

interface FormState {
  companyName: string
  cin: string
  reportType: ReportType
  cyStart: string
  cyEnd: string
  firstYear: boolean
  pyStart: string
  pyEnd: string
  /** once the user edits PY dates we stop deriving them from CY */
  pyTouched: boolean
  level: RoundingLevel
  displayPlaces: number
}

function initialForm(): FormState {
  const cy = defaultReportingYear(new Date())
  const py = previousYearOf(cy)!
  return { companyName: '', cin: '', reportType: 'Standalone', cyStart: cy.start, cyEnd: cy.end, firstYear: false, pyStart: py.start, pyEnd: py.end, pyTouched: false, level: 'Lakhs', displayPlaces: defaultDisplayPlaces('Lakhs') }
}

export function toInput(f: FormState): NewFilingInput {
  return {
    companyName: f.companyName,
    cin: f.cin.trim().toUpperCase(),
    reportType: f.reportType,
    cy: { start: f.cyStart, end: f.cyEnd },
    py: f.firstYear ? null : { start: f.pyStart, end: f.pyEnd },
    level: f.level,
    displayPlaces: f.displayPlaces,
  }
}

/** New Filing wizard (docs/08-ui-ux.md). Excel import comes with the editor in Phase 4. */
export function NewFilingDialog() {
  const { newFilingOpen, closeNewFiling, create } = useProject()
  const [f, setF] = useState<FormState>(initialForm)
  const [serverProblems, setServerProblems] = useState<string[]>([])
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (newFilingOpen) {
      setF(initialForm())
      setServerProblems([])
      setSubmitted(false)
    }
  }, [newFilingOpen])

  const patch = (p: Partial<FormState>) =>
    setF((cur) => {
      const next = { ...cur, ...p }
      if (!next.pyTouched && ('cyStart' in p || 'cyEnd' in p)) {
        const py = previousYearOf({ start: next.cyStart, end: next.cyEnd })
        if (py) Object.assign(next, { pyStart: py.start, pyEnd: py.end })
      }
      return next
    })

  const input = toInput(f)
  const cinError = f.cin && !isValidCin(f.cin) ? 'A CIN has 21 characters, e.g. U72200KA2010PTC123456' : null
  const periodErrors = useMemo(() => validateFilingPeriods(input.cy, input.py), [input.cy.start, input.cy.end, input.py?.start, input.py?.end])
  const nameError = submitted && !f.companyName.trim() ? 'Enter the company name' : null
  const canSubmit = Boolean(f.companyName.trim() && isValidCin(f.cin) && periodErrors.length === 0)

  const submit = async () => {
    setSubmitted(true)
    if (!canSubmit) return
    setBusy(true)
    setServerProblems(await create(input))
    setBusy(false)
  }

  return (
    <Dialog
      open={newFilingOpen}
      title="New filing — AOC-4 XBRL (C&I 2016)"
      onClose={closeNewFiling}
      width={620}
      footer={
        <>
          <Button variant="ghost" onClick={closeNewFiling}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || (submitted && !canSubmit)}>
            {busy ? 'Creating…' : 'Create filing'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Section title="Company">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Company name" error={nameError} className="col-span-2">
              <Input value={f.companyName} onChange={(e) => patch({ companyName: e.target.value })} placeholder="Acme Private Limited" autoFocus />
            </Field>
            <Field label="CIN" error={cinError} hint="Corporate Identity Number">
              <Input
                value={f.cin}
                maxLength={21}
                className="font-mono uppercase"
                onChange={(e) => patch({ cin: e.target.value.toUpperCase() })}
                placeholder="U72200KA2010PTC123456"
              />
            </Field>
            <Field label="Nature of report">
              <Select value={f.reportType} onChange={(e) => patch({ reportType: e.target.value as ReportType })}>
                <option value="Standalone">Standalone</option>
                <option value="Consolidated">Consolidated</option>
              </Select>
            </Field>
          </div>
        </Section>

        <Section title={`Reporting period · ${fyLabel(input.cy)}`}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Current year — start">
              <Input type="date" value={f.cyStart} onChange={(e) => patch({ cyStart: e.target.value })} />
            </Field>
            <Field label="Current year — end">
              <Input type="date" value={f.cyEnd} onChange={(e) => patch({ cyEnd: e.target.value })} />
            </Field>
            <Field label="Previous year — start">
              <Input type="date" value={f.pyStart} disabled={f.firstYear} onChange={(e) => patch({ pyStart: e.target.value, pyTouched: true })} />
            </Field>
            <Field label="Previous year — end">
              <Input type="date" value={f.pyEnd} disabled={f.firstYear} onChange={(e) => patch({ pyEnd: e.target.value, pyTouched: true })} />
            </Field>
            <div className="col-span-2">
              <Checkbox checked={f.firstYear} onChange={(firstYear) => patch({ firstYear })} label="First financial year of the company (no previous-year figures)" />
            </div>
          </div>
          {periodErrors.map((e) => (
            <p key={e} className="text-[11px] text-err">
              {e}
            </p>
          ))}
        </Section>

        <Section title="Presentation">
          <Field label="Level of rounding used in the financial statements" hint="As printed in the statements (e.g. ₹ in lakhs).">
            <Select
              value={f.level}
              onChange={(e) => {
                const level = e.target.value as RoundingLevel
                patch({ level, displayPlaces: defaultDisplayPlaces(level) })
              }}
            >
              {ROUNDING_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Decimal places as presented" hint="As printed (₹ 5,443.47 lakhs = 2). Excel figures are rounded to the cell's format, never past these places.">
            <Select value={f.displayPlaces} onChange={(e) => patch({ displayPlaces: Number(e.target.value) })} data-testid="display-places">
              {Array.from({ length: maxDisplayPlaces(f.level) + 1 }, (_, n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
        </Section>

        {serverProblems.length > 0 && (
          <ul className="rounded border border-err/40 bg-err/5 p-3 text-[12px] text-err">
            {serverProblems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
