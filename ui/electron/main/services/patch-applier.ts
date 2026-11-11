/**
 * PatchApplier (Phase 10, ADR-0012): applies an accepted AI patch, always through the ordinary editing paths.
 * - Excel-linked ops go through MappingService, so the cell ↔ fact linkage stays and the tag records origin 'ai' with
 *   the patch's confidence: a value read from a cell (tag the cell), a re-tag (an accepted re-tag teaches the mapping
 *   memory like any tag; a rejected one never reaches this class), a change of year.
 * - Other ops go through the engine's applyFactPatch (Session: applicability, decimals, recalculated totals); removing
 *   a fact that came from Excel removes its tag as well.
 * Electron-free; unit-tested.
 */
import { applyFactPatch, type FactPatch } from '@xap/engine'
import type { AiPatch } from '@shared/ai'
import type { Scope } from '@shared/editor'
import { ValidationError } from './errors'
import type { MappingService, TagProvenance } from './mapping-service'
import type { ProjectHandle } from './ports'

export class PatchApplier {
  constructor(private readonly mapping: MappingService) {}

  async apply(p: ProjectHandle, patch: AiPatch, input?: string | null): Promise<void> {
    const prov: TagProvenance = { origin: 'ai', confidence: typeof patch.confidence === 'number' ? patch.confidence : null, rationale: patch.rationale?.slice(0, 300) }
    if (patch.op === 'remap' || patch.op === 'setScope') {
      const tag = this.mapping.approvedAt(patch.cell!)
      if (!tag) throw new ValidationError([`${patch.cell!.sheet}!${patch.cell!.ref} is no longer tagged.`])
      if (patch.op === 'remap') await this.mapping.tag({ cell: tag.cell, concept: patch.to!, scope: tag.fact.scope, sign: tag.sign }, prov)
      else await this.mapping.setScope(tag.id, patch.to as Scope, prov)
      return
    }
    if (patch.op === 'setValue' && patch.source?.kind === 'cell') {
      await this.mapping.tag({ cell: patch.source.cell, concept: patch.fact!.concept, scope: patch.fact!.scope }, prov)
      return
    }
    if (patch.op === 'removeFact') {
      const tag = this.mapping.list().find((m) => m.status === 'approved' && m.factKey === patch.fact!.key)
      if (tag) {
        this.mapping.untag(tag.id)
        return
      }
    }
    try {
      applyFactPatch(p.session, patch as FactPatch, { input })
    } catch (err) {
      throw new ValidationError([err instanceof Error ? err.message : String(err)])
    }
    p.touch()
  }
}
