/**
 * PatchVerifier (Phase 10, ADR-0012): decides whether an AI patch may be shown, and what its card says.
 *
 * 1. The engine's checkPatch: element, type, applicability, locked year, arithmetic identity.
 * 2. The Excel side: a value read from a cell must be what the cell shows (at the filing's precision), in a column of
 *    that year, and the cell must not be tagged as something else; a re-tag / year change needs a tagged cell; a value
 *    that came from Excel is not overwritten by a typed one (ADR-0009: amounts come from Excel).
 * 3. A dry run on a copy of the filing: does the patch clear its problem?
 * Electron-free; unit-tested.
 */
import { checkPatch, decimal as Dec, dryRun, type FactPatch, type FixPatch } from '@xap/engine'
import type { AiPatch, AiPatchCard } from '@shared/ai'
import type { MappingView } from '@shared/editor'
import type { Problem } from '@shared/validation'
import type { CellRef } from '@shared/workbook'
import type { ColumnPeriodService } from './column-period-service'
import type { MappingService } from './mapping-service'
import type { ProjectHandle } from './ports'
import { issueSignature, problemSignature, type GateIssue } from './validation-service'

export type CardDraft = Omit<AiPatchCard, 'id' | 'proposalId' | 'status'>
export type Verified = { ok: true; card: CardDraft } | { ok: false; reason: string }

const YEAR = { CY: 'current year', PY: 'previous year' } as const
const cellText = (c: CellRef) => `${c.sheet}!${c.ref}`
const plain = (v: string) => v.trim().replace(/,/g, '')

type Authority = { label(q: string): string; conceptElrs(q: string): string[] }

export class PatchVerifier {
  constructor(
    private readonly mapping: MappingService,
    private readonly columns: ColumnPeriodService,
    private readonly today: () => string,
  ) {}

  async verify(p: ProjectHandle, patch: AiPatch, problem: Problem, input?: string | null): Promise<Verified> {
    const A = p.authority.authority as unknown as Authority
    const engine = checkPatch(p.session, patch as FixPatch, { input })
    if (!engine.ok) return { ok: false, reason: `engine: ${engine.problems.join(' ')}` }
    const excel = await this.excelProblem(p, patch)
    if (excel) return { ok: false, reason: `excel: ${excel}` }

    const concept = patch.fact?.concept ?? (patch.op === 'remap' ? patch.to! : this.taggedAt(patch.cell)?.fact.concept ?? null)
    const card: CardDraft = {
      patch,
      title: titleOf(patch, A, this.taggedAt(patch.cell)),
      before: engine.before,
      after: engine.after,
      sourceLabel: sourceLabel(patch, p, A),
      needsInput: engine.needsInput,
      needsConfirm: engine.needsConfirm,
      resolves: null,
      factKey: engine.factKey ?? this.taggedAt(patch.cell)?.factKey ?? null,
      cell: patch.cell ?? (patch.source?.kind === 'cell' ? patch.source.cell : null) ?? this.cellOfFact(engine.factKey),
      elrUri: problem.location?.elrUri ?? (concept ? A.conceptElrs(concept)[0] ?? null : null),
      rationale: patch.rationale ?? '',
      confidence: typeof patch.confidence === 'number' ? patch.confidence : null,
    }
    card.resolves = this.resolves(p, problem, patch, input)
    return { ok: true, card }
  }

  /** Dry run: true when the problem's issue is gone from a copy of the filing with the patch applied. */
  resolves(p: ProjectHandle, problem: Problem, patch: AiPatch, input?: string | null): boolean | null {
    const sig = problemSignature(problem.id)
    const plan = this.plan(p, patch, input)
    if (!sig || !plan) return null
    const run = dryRun(p.session, plan, { today: this.today() })
    if (run.failed.length) return false
    return !(run.issues as GateIssue[]).some((i) => issueSignature(i) === sig)
  }

  // ---------------------------------------------------------------------------------------------------- internals
  private taggedAt(cell: CellRef | undefined): MappingView | null {
    return cell ? this.mapping.approvedAt(cell) : null
  }

  private cellOfFact(factKey: string | null): CellRef | null {
    if (!factKey) return null
    return this.mapping.list().find((m) => m.status === 'approved' && m.factKey === factKey)?.cell ?? null
  }

  private async excelProblem(p: ProjectHandle, patch: AiPatch): Promise<string | null> {
    if (patch.op === 'remap' || patch.op === 'setScope') {
      const tag = this.taggedAt(patch.cell)
      if (!tag) return `${cellText(patch.cell!)} is not tagged.`
      if (patch.op === 'remap' && patch.from && patch.from !== tag.fact.concept) return `${cellText(patch.cell!)} is tagged as ${tag.conceptLabel}, not ${patch.from}.`
      if (patch.op === 'setScope' && patch.to === tag.fact.scope) return `${cellText(patch.cell!)} is already the ${YEAR[patch.to]}.`
      return null
    }
    const fact = patch.fact!
    const fromExcel = this.mapping.list().find((m) => m.status === 'approved' && m.fact.concept === fact.concept && m.fact.scope === fact.scope && m.fact.dims.length === 0)
    const source = patch.source
    if (source?.kind === 'cell') {
      const info = await this.mapping.cellInfo(source.cell).catch(() => null)
      if (!info?.amount) return `${cellText(source.cell)} shows no amount.`
      if (patch.op === 'setValue' && patch.value != null && !Dec.eq(Dec.parse(info.amount.value), Dec.parse(plain(patch.value)))) {
        return `${cellText(source.cell)} shows ${info.amount.value}, not ${patch.value}.`
      }
      const column = await this.columns.of(source.cell).catch(() => null)
      if (column?.scope && column.scope !== fact.scope) return `column ${column.column} holds the ${YEAR[column.scope]}, not the ${YEAR[fact.scope]}.`
      const there = this.taggedAt(source.cell)
      if (there && (there.fact.concept !== fact.concept || there.fact.scope !== fact.scope)) return `${cellText(source.cell)} is already tagged as ${there.conceptLabel} (${there.fact.scope}).`
      return null
    }
    if (fromExcel && patch.op !== 'removeFact') {
      return `this value comes from Excel ${cellText(fromExcel.cell)}; change the cell or re-tag it instead of typing over it.`
    }
    return null
  }

  /** The patch as fact-level edits, for the dry run; null when it cannot be simulated (a value still to be typed). */
  private plan(p: ProjectHandle, patch: AiPatch, input?: string | null): { patch: FactPatch; input?: string | null }[] | null {
    if (patch.op === 'remap' || patch.op === 'setScope') {
      const tag = this.taggedAt(patch.cell)
      const fact = tag?.factKey ? (p.session.filing as unknown as { facts: Map<string, { key: string }> }).facts.get(tag.factKey) : null
      if (!tag || !fact || tag.value == null) return null
      const concept = patch.op === 'remap' ? patch.to! : tag.fact.concept
      const scope = patch.op === 'setScope' ? patch.to! : tag.fact.scope
      const numeric = (p.authority.authority as unknown as { isNumeric(q: string): boolean }).isNumeric(concept)
      return [
        { patch: { op: 'removeFact', fact: { key: fact.key, concept: tag.fact.concept, scope: tag.fact.scope } } },
        { patch: { op: numeric ? 'setValue' : 'setText', fact: { concept, scope }, value: tag.value, source: { kind: 'user' } } as FactPatch, input: tag.value },
      ]
    }
    if (patch.source?.kind === 'user' && !(input ?? patch.value)) return null
    return [{ patch: patch as FactPatch, input }]
  }
}

function titleOf(patch: AiPatch, A: Authority, tag: MappingView | null): string {
  const el = (q: string | undefined) => (q ? A.label(q) : '?')
  const yr = (s: 'CY' | 'PY' | undefined) => (s ? ` (${YEAR[s]})` : '')
  switch (patch.op) {
    case 'setValue': return `Set ${el(patch.fact?.concept)}${yr(patch.fact?.scope)}`
    case 'setText': return `Set ${el(patch.fact?.concept)}${yr(patch.fact?.scope)}`
    case 'setNil': return `Report ${el(patch.fact?.concept)}${yr(patch.fact?.scope)} as nil`
    case 'removeFact': return `Remove ${el(patch.fact?.concept)}${yr(patch.fact?.scope)}`
    case 'remap': return `Re-tag ${cellText(patch.cell!)} as ${el(patch.to)}`
    case 'setScope': return `Move ${cellText(patch.cell!)}${tag ? ` (${tag.conceptLabel})` : ''} to the ${YEAR[patch.to as 'CY' | 'PY']}`
  }
}

function sourceLabel(patch: AiPatch, p: ProjectHandle, A: Authority): string | null {
  const s = patch.source
  if (!s) return null
  if (s.kind === 'cell') return `Excel ${cellText(s.cell)}`
  if (s.kind === 'user') return 'you type it'
  const facts = (p.session.filing as unknown as { facts: Map<string, { concept: string }> }).facts
  return '= ' + s.terms.map((t, i) => `${i === 0 ? (t.weight < 0 ? '−' : '') : t.weight < 0 ? ' − ' : ' + '}${A.label(facts.get(t.factKey)?.concept ?? t.factKey)}`).join('')
}
