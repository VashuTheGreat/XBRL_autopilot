/**
 * Pure helpers for the Ind AS pipeline screen (docs/17): canonical rows → taggable lines, the suggestion key,
 * master-field prefill and the /generateXML input. No React, no IPC (tested in ui/test/indas-model.test.ts).
 */
import {
  TAGGED_STATEMENTS,
  type CanonicalRow,
  type ConceptSuggestion,
  type GenerateXmlInput,
  type MasterField,
  type Signatory,
  type StatementKey,
  type TransformResult,
} from '@shared/indas'

export interface TagRow {
  id: string
  statement: StatementKey
  label: string
  breadcrumb: string
  note: string
  cy: number | null
  py: number | null
  suggestions: ConceptSuggestion[]
  /** the concept the user accepted ('' = not tagged) */
  concept: string
}

export interface FilingMeta {
  nature: 'Standalone' | 'Consolidated'
  startDate: string
  endDate: string
}

const text = (v: CanonicalRow[string] | undefined) => (v === null || v === undefined ? '' : String(v).trim())

/** A canonical amount as a number; blanks, dashes and non-numbers are null. Values pass through unchanged. */
export function amount(v: CanonicalRow[string] | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const t = v.replace(/,/g, '').trim()
  if (t === '' || t === '-') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** The statement lines that carry an amount, in sheet order, ready to tag. */
export function rowsFromTransform(t: TransformResult): TagRow[] {
  const out: TagRow[] = []
  for (const st of TAGGED_STATEMENTS) {
    ;(t.sheets[st.sheet] ?? []).forEach((r, i) => {
      const cy = amount(r.Current_Year_Amount)
      const py = amount(r.Previous_Year_Amount)
      const label = text(r.Line_Item)
      if (!label || (cy === null && py === null)) return
      out.push({ id: `${st.key}:${i}`, statement: st.key, label, breadcrumb: text(r.Breadcrumb_Hierarchy), note: text(r.Note_No).replace(/\.0$/, ''), cy, py, suggestions: [], concept: '' })
    })
  }
  return out
}

/** What the tagger searches with: the breadcrumb (it carries the section) or else the line item. */
export function suggestionKey(r: Pick<TagRow, 'label' | 'breadcrumb'>): string {
  return r.breadcrumb || r.label
}

/** Accept the top suggestion on every row the user hasn't tagged yet. */
export function acceptTopSuggestions(rows: TagRow[]): TagRow[] {
  return rows.map((r) => (r.concept || !r.suggestions[0] ? r : { ...r, concept: r.suggestions[0].qname }))
}

/** Values the app already knows (period, nature) for the matching master fields; the user's own values win. */
export function prefillMasters(fields: MasterField[], meta: FilingMeta, current: Record<string, string>): Record<string, string> {
  const known: Record<string, string> = {
    DateOfStartOfReportingPeriod: meta.startDate,
    DateOfEndOfReportingPeriod: meta.endDate,
    NatureOfReportStandaloneConsolidated: meta.nature,
  }
  const out = { ...current }
  for (const f of fields) {
    const local = f.qname.split(':').pop() ?? f.qname
    if (!out[f.qname] && known[local]) out[f.qname] = known[local]
  }
  return out
}

/** How a master field is edited, from its XBRL item type. */
export function fieldKind(type: string): 'date' | 'boolean' | 'text' | 'longtext' {
  if (/date/i.test(type)) return 'date'
  if (/boolean/i.test(type)) return 'boolean'
  if (/textBlock/i.test(type)) return 'longtext'
  return 'text'
}

/** Problems that would make /generateXML refuse, found before sending (the sidecar checks again). */
export function readinessProblems(input: { rows: TagRow[]; meta: FilingMeta; signatories: Signatory[]; companyFields: MasterField[]; company: Record<string, string> }): string[] {
  const p: string[] = []
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.meta.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.meta.endDate)) p.push('Enter the financial year start and end dates.')
  if (!input.rows.some((r) => r.concept)) p.push('Tag at least one statement line.')
  const missing = input.companyFields.filter((f) => !(input.company[f.qname] ?? '').trim())
  if (missing.length) p.push(`Fill the company details: ${missing.map((f) => f.label).join(', ')}.`)
  if (input.signatories.length < 2) p.push('Add at least 2 signatory directors.')
  input.signatories.forEach((s, i) => {
    if (!/^\d{8}$/.test(s.din.trim())) p.push(`Signatory ${i + 1}: DIN must be 8 digits.`)
  })
  return p
}

export function buildGenerateInput(s: {
  rows: TagRow[]
  meta: FilingMeta
  company: Record<string, string>
  auditor: Record<string, string>
  signatories: Signatory[]
  companyNameField?: string
}): GenerateXmlInput {
  const lines = (key: StatementKey) => s.rows.filter((r) => r.statement === key && r.concept).map((r) => ({ concept: r.concept, cy: r.cy, py: r.py }))
  const nameKey = s.companyNameField ?? Object.keys(s.company).find((k) => k.endsWith(':NameOfCompany')) ?? ''
  return {
    meta: s.meta,
    master: { company: s.company, auditor: s.auditor, signatories: s.signatories },
    statements: { balanceSheet: lines('balanceSheet'), profitLoss: lines('profitLoss') },
    companyName: (nameKey && s.company[nameKey]) || 'Filing',
  }
}

/** Amounts with Indian digit grouping (display only); blank for no amount. */
export function formatAmount(v: number | null): string {
  return v === null ? '' : v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}
