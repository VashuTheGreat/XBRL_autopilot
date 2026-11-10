/**
 * Creates a filing from an existing XBRL instance (Webtel or any vendor), Phase 7:
 *   - picks the taxonomy from the instance's schemaRef (C&I 2016 or Ind AS 2017);
 *   - imports every fact, or the current year only as next year's previous year (`next`);
 *   - for `both`, regenerates the filing and compares it with the source fact by fact, so the user sees proof
 *     that nothing was lost or changed, plus the vendor conventions that differ from ours.
 * Electron-free; the instance text comes from the caller.
 */
import { importXbrl, instanceConventions, readSchemaRef, Session, verifyRoundTrip, type InstanceComparison } from '@xap/engine'
import { FILING_TAXONOMIES, maxDisplayPlaces, taxonomyLabel, type RoundingLevel } from '@xap/engine/basics'
import type { ImportReportView, InstanceImportMode, ProjectSummary } from '@shared/project'
import { ValidationError } from './errors'
import type { AuthorityProvider, Clock, LoadedAuthority } from './ports'
import { systemClock } from './ports'
import type { ProjectService } from './project-service'

const MAX_LISTED = 200

interface AuthorityMeta {
  schemaRef: string
  entryPoint: string
  acceptedSchemaRefs?: { href: string }[]
  retiredSchemaRefs?: string[]
}

export class InstanceImportService {
  constructor(
    private readonly authority: AuthorityProvider,
    private readonly projects: ProjectService,
    private readonly clock: Clock = systemClock,
  ) {}

  async importInstance(fileName: string, xml: string, mode: InstanceImportMode): Promise<{ summary: ProjectSummary; report: ImportReportView }> {
    if (mode !== 'both' && mode !== 'next') throw new ValidationError(['Choose how to import the instance.'])
    const schemaRef = readSchemaRef(xml)
    if (!schemaRef) throw new ValidationError([`${fileName} is not an XBRL instance (it has no schemaRef).`])
    const loaded = await this.taxonomyFor(schemaRef)

    let imported: ReturnType<typeof importXbrl>
    try {
      imported = importXbrl(loaded.authority, xml, { fileName, mode })
    } catch (err) {
      throw new ValidationError([`${fileName} could not be read: ${(err as Error).message}`])
    }
    const { filing, report } = imported
    if (report.errors?.length) throw new ValidationError(report.errors.map(String))
    if (!report.counts?.imported) throw new ValidationError([`No facts of ${fileName} could be imported.`])

    this.normaliseMeta(loaded, filing, fileName)
    const today = this.clock.now().toISOString().slice(0, 10)
    const roundTrip = mode === 'both' ? verifyRoundTrip(loaded.authority, filing, xml, today) : null
    const ours = new Session(loaded.authority, filing as never).exportXml({ today, allowErrors: true }) as { xml: string }
    const meta = (filing as { meta: { periods: ImportReportView['periods'] & { py: { start: string } }; firstFinancialYear: boolean } }).meta

    const view: ImportReportView = {
      fileName,
      mode,
      taxonomy: loaded.taxonomyId,
      schemaRef,
      periods: { cy: { ...meta.periods.cy }, py: meta.firstFinancialYear || !meta.periods.py?.start ? null : { ...meta.periods.py } },
      counts: {
        sourceFacts: report.counts.sourceFacts,
        imported: report.counts.imported,
        unresolved: report.counts.unresolved,
        footnotes: report.counts.footnotes,
        skippedPrevious: (report.byYear?.skippedPrevious ?? 0) + (report.byYear?.skippedPreviousOpening ?? 0),
      },
      warnings: (report.warnings ?? []).map(String),
      unresolved: (report.unresolvedFacts ?? []).slice(0, MAX_LISTED).map((u: { concept?: string; element?: string; contextRef?: string; reason: string }) => ({
        concept: u.concept ?? u.element ?? '?',
        context: u.contextRef ?? null,
        reason: u.reason,
      })),
      roundTrip: roundTrip && trim(roundTrip),
      conventions: { source: instanceConventions(xml), ours: instanceConventions(ours.xml) },
    }
    const summary = await this.projects.adoptImported({ loaded, filing, fileName, sourceXml: xml, report: { view, importer: report }, mode })
    return { summary, report: view }
  }

  /** The filing taxonomy whose entry point the schemaRef names (V3, retired V2, or any mirror of the same file). */
  private async taxonomyFor(schemaRef: string): Promise<LoadedAuthority> {
    const file = schemaRef.split(/[/\\]/).pop()
    for (const t of FILING_TAXONOMIES) {
      const loaded = await this.authority.load(t.id)
      const meta = loaded.authority.meta as AuthorityMeta
      const known = [meta.schemaRef, ...(meta.acceptedSchemaRefs ?? []).map((r) => r.href), ...(meta.retiredSchemaRefs ?? [])]
      if (known.includes(schemaRef) || file === meta.entryPoint) return loaded
    }
    throw new ValidationError([
      `This instance uses the schema ${schemaRef}, which is not ${FILING_TAXONOMIES.map((t) => taxonomyLabel(t.id)).join(' or ')}.`,
    ])
  }

  /** The importer names the company after the file; take the filed NameOfCompany, and allow paise like a new filing (ADR-0009). */
  private normaliseMeta(loaded: LoadedAuthority, filing: unknown, fileName: string): void {
    const f = filing as { meta: { name: string; level: RoundingLevel; displayPlaces: number } }
    const nameOfCompany = loaded.authority.qnameOfLocal('NameOfCompany')
    const filed = nameOfCompany ? new Session(loaded.authority, filing as never).getValue(nameOfCompany, 'CY')?.value : null
    f.meta.name = (typeof filed === 'string' && filed.trim()) || f.meta.name || fileName.replace(/\.xml$/i, '')
    f.meta.displayPlaces = maxDisplayPlaces(f.meta.level)
  }
}

function trim(c: InstanceComparison): ImportReportView['roundTrip'] {
  return {
    identical: c.identical,
    sourceFacts: c.sourceFacts,
    equal: c.equal,
    missing: c.missing.slice(0, MAX_LISTED),
    extra: c.extra.slice(0, MAX_LISTED),
    changed: c.changed.slice(0, MAX_LISTED),
  }
}
