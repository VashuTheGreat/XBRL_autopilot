/**
 * "Save as footnote" in View details (docs/14 Step 3): writes how a summed figure is made up as an XBRL footnote on
 * its fact, through the engine's footnote store (core/footnotes.js), which the generator writes and `.axbrl` saves.
 */
import { addFootnote, footnotesOf, listFootnotes } from '@xap/engine'
import { formatIndian } from '@xap/engine/basics'
import type { MappingDetails } from '@shared/editor'
import { ValidationError } from './errors'
import type { ProjectAccess } from './ports'

export interface SavedFootnote {
  footnoteId: string
  text: string
}

/** "Comprises 1,23,456 (Balance Sheet C14) + 567 (Notes D20) = 1,24,023." */
export function sourcesFootnoteText(d: MappingDetails): string {
  const parts = d.sources.map((s, i) => {
    const amount = s.value ?? '?'
    const negative = amount.startsWith('-')
    const shown = `${formatIndian(negative ? amount.slice(1) : amount)} (${s.cell.sheet} ${s.cell.ref})`
    return i === 0 ? `${negative ? '−' : ''}${shown}` : `${negative ? ' − ' : ' + '}${shown}`
  })
  return `Comprises ${parts.join('')} = ${formatIndian(d.total ?? '?')}.`
}

export class SourceFootnoteService {
  constructor(
    private readonly projects: ProjectAccess,
    private readonly details: (mappingId: string) => Promise<MappingDetails>,
  ) {}

  /** Attaches the make-up of a tag's figure to its fact as a footnote; the same text is not added twice. */
  async save(mappingId: string): Promise<SavedFootnote> {
    const d = await this.details(mappingId)
    if (!d.factKey) throw new ValidationError(['The figure has no value in the filing: nothing to attach a footnote to.'])
    if (d.sources.some((s) => s.value === null)) throw new ValidationError(['A source no longer reads as an amount: fix or remove it first.'])
    const p = this.projects.project()
    const filing = p.session.filing
    const text = sourcesFootnoteText(d)
    const existing = footnotesOf(filing, d.factKey).find((id: string) => listFootnotes(filing).find((f: { id: string; text: string }) => f.id === id)?.text === text)
    if (existing) return { footnoteId: existing, text }
    const footnoteId = addFootnote(filing, text, [d.factKey]) as string
    p.touch()
    return { footnoteId, text }
  }
}
