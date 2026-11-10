/**
 * FilingPropertiesService: presentation settings of the open filing that can change after it was created.
 * Changing "decimal places as presented" re-pulls every tagged figure from Excel, so the facts and their
 * declared accuracy follow the new setting (the engine fixes a fact's decimals when the value is entered).
 */
import { maxDisplayPlaces, type RoundingLevel } from '@xap/engine/basics'
import { ValidationError } from './errors'
import type { ProjectAccess } from './ports'

export interface TagReapplier {
  /** returns the problems of tags that could not be re-applied */
  reapply(): Promise<string[]>
}

export class FilingPropertiesService {
  constructor(
    private readonly projects: ProjectAccess,
    private readonly tags: TagReapplier,
  ) {}

  /** Returns the tags that kept their old value (with the reason). */
  async setStatementPlaces(places: number): Promise<string[]> {
    const p = this.projects.project()
    const meta = p.session.filing.meta as { level: RoundingLevel; statementPlaces?: number | null; displayPlaces?: number }
    const max = maxDisplayPlaces(meta.level)
    if (!Number.isInteger(places) || places < 0 || places > max) {
      throw new ValidationError([`Decimal places as presented must be a whole number from 0 to ${max} for amounts in ${meta.level}.`])
    }
    if (meta.statementPlaces === places) return []
    // filings created before statementPlaces existed carry the statement places in displayPlaces: widen it to paise
    p.session.setMeta({ statementPlaces: places, displayPlaces: Math.max(Number(meta.displayPlaces) || 0, max) })
    const problems = await this.tags.reapply()
    p.touch()
    return problems
  }
}
