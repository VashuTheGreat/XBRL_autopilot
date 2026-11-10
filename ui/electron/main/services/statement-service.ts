/**
 * StatementService: explicit, deterministic actions on one statement (ELR) of the open filing.
 * Thin over the engine (fillMandatoryZeros); returns what changed, labelled for the user.
 */
import { fillMandatoryZeros } from '@xap/engine'
import type { ZeroFilled } from '@shared/editor'
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
}
