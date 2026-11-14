/**
 * Statement tree marks for the Form (docs/14 Step 2): the engine's form-marks (E / L / T from taxonomy data, empty
 * mandatory lines from the MCA rules) turned into FormRow fields, plus whether a line is tagged from Excel.
 * Pure functions of the session and the row's cells.
 */
import { elrTableOf, mandatoryGap, textBlockMark, type Session } from '@xap/engine'
import type { FormCell, FormRow, FormRowMandatory, Scope } from '@shared/editor'

type Authority = Parameters<typeof textBlockMark>[0]
const authorityOf = (session: Session) => (session as unknown as { A: Authority }).A

/** T and its table for a table node of the tree; nothing for a table the Form doesn't show as a grid (no axes). */
export function tableMarks(session: Session, elrUri: string, hypercube: string): Pick<FormRow, 'marker' | 'tableId'> {
  const tableId = elrTableOf(authorityOf(session), elrUri, hypercube)
  return tableId ? { marker: 'T', tableId } : {}
}

/** E / L, the empty mandatory years and the tagged flag of a reportable line. */
export function itemMarks(session: Session, elrUri: string, concept: string, cells: { cy?: FormCell; py?: FormCell }): Pick<FormRow, 'marker' | 'linkedElrs' | 'mandatory' | 'tagged'> {
  const text = textBlockMark(authorityOf(session), concept, elrUri)
  const mandatory = mandatoryYears(session, elrUri, concept, (cells.py ? ['CY', 'PY'] : ['CY']) as Scope[])
  const tagged = [cells.cy, cells.py].some((c) => !!c?.source)
  return {
    ...(text ? { marker: text.marker, ...(text.linkedElrs.length ? { linkedElrs: text.linkedElrs } : {}) } : {}),
    ...(mandatory ? { mandatory } : {}),
    ...(tagged ? { tagged } : {}),
  }
}

function mandatoryYears(session: Session, elrUri: string, concept: string, years: Scope[]): FormRowMandatory | undefined {
  const out: FormRowMandatory = { rules: [] }
  for (const y of years) {
    const gap = mandatoryGap(session, concept, y, elrUri)
    if (!gap) continue
    out[y === 'CY' ? 'cy' : 'py'] = true
    for (const r of gap.rules) if (!out.rules.includes(r)) out.rules.push(r)
    if (gap.conditional) out.conditional = true
  }
  return out.cy || out.py ? out : undefined
}
