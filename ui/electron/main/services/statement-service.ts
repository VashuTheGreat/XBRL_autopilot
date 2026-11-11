/**
 * StatementService: explicit, deterministic actions on one statement (ELR) of the open filing.
 * Thin over the engine (fillMandatoryZeros); returns what changed, labelled for the user.
 */
import { fillMandatoryZeros, fillTableMandatoryZeros } from '@xap/engine'
import { displayLabel, type TableZeroFilled, type ZeroFilled } from '@shared/editor'
import { ValidationError } from './errors'
import type { ProjectAccess } from './ports'

export class StatementService {
  constructor(private readonly projects: ProjectAccess) {}

  /** Reports the statement's empty mandatory amounts (lines the company doesn't have) as 0. */
  fillMandatoryZeros(elrUri: string): ZeroFilled[] {
    const p = this.projects.project()
    const A = p.authority.authority
    const elr = A.elr(elrUri) as { code: string } | null
    if (!elr) throw new ValidationError(['That statement is not part of this taxonomy.'])
    const filled = fillMandatoryZeros(p.session, elr.code)
    if (filled.length) p.touch()
    return filled.map((z) => ({ concept: z.concept, label: A.label(z.concept), scope: z.scope }))
  }

  /**
   * Reports as 0 the line items the mandatory-line-items rules require in the columns of this statement's tables that
   * already hold a value (ADR-0013: zeros come from the rules; a column with no value is never started).
   */
  fillTableZeros(elrUri: string): TableZeroFilled[] {
    const p = this.projects.project()
    const A = p.authority.authority as unknown as { elr(u: string): unknown; tables: { id: string; presentationElr: string }[]; label(q: string): string }
    if (!A.elr(elrUri)) throw new ValidationError(['That statement is not part of this taxonomy.'])
    const filled = A.tables.filter((t) => t.presentationElr === elrUri).flatMap((t) => fillTableMandatoryZeros(p.session, t.id))
    if (filled.length) p.touch()
    return filled.map((z) => ({
      tableId: z.tableId,
      concept: z.concept,
      label: A.label(z.concept),
      scope: z.scope,
      memberLabels: z.dims.map((d) => (d.member ? displayLabel(A.label(d.member)) : String(d.typed))),
    }))
  }
}
