/**
 * Statement ↔ note matching for the Form (docs/14 Step 1): the engine's noteTies / statementDifference turned into
 * the Form's read-model, amounts shown in the filing's level of rounding. Pure functions of the session.
 */
import { noteTies, statementDifference, toDisplay, type Session, type TiePeriod } from '@xap/engine'
import type { FormDifference, FormRowNote, NoteTieView } from '@shared/editor'

const levelOf = (session: Session) => (session.filing.meta as { level?: string }).level ?? 'Actual'

function shown(value: string | null, level: string): string | null {
  return value == null ? null : String(toDisplay(value, level))
}

function tieView(p: TiePeriod, level: string): NoteTieView {
  return { status: p.status, statement: shown(p.statement, level), note: shown(p.note, level), difference: shown(p.difference, level) }
}

/** The statement lines of this ELR that a note supplies, by concept (empty for notes and disclosures). */
export function rowNotes(session: Session, elrUri: string, hasPy: boolean): Map<string, FormRowNote> {
  const level = levelOf(session)
  return new Map(
    noteTies(session, elrUri).map((t) => [
      t.concept,
      {
        elrUri: t.target.elrUri,
        ...(t.target.tableId ? { tableId: t.target.tableId } : {}),
        concept: t.target.concept,
        cy: tieView(t.cy, level),
        ...(hasPy ? { py: tieView(t.py, level) } : {}),
      },
    ]),
  )
}

/** Whether a main statement's own totals add up, per year; undefined for notes and disclosures. */
export function formDifference(session: Session, elrUri: string, isStatement: boolean, hasPy: boolean): FormDifference | undefined {
  if (!isStatement) return undefined
  const level = levelOf(session)
  const d = statementDifference(session, elrUri)
  const py = hasPy ? d.py : null
  return {
    ...(d.cy ? { cy: shown(d.cy.difference, level)! } : {}),
    ...(py ? { py: shown(py.difference, level)! } : {}),
    issues: (d.cy?.issues.length ?? 0) + (py?.issues.length ?? 0),
  }
}
