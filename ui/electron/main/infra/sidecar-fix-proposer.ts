/** FixProposer over the sidecar's POST /api/v1/fix/propose (src/services/fix_agent). */
import type { FixBundle, FixProposal, FixProposer, SidecarClient } from '../services/ports'
import { sidecarCall } from './sidecar-call'
import { KB_TAXONOMY_ID } from './sidecar-taxonomy-catalog'

/** Up to 6 LLM calls of at most 60 s each, plus the tools. */
export const FIX_TIMEOUT_MS = 6 * 60_000 + 30_000

export class SidecarFixProposer implements FixProposer {
  constructor(private readonly sidecar: SidecarClient) {}

  propose(bundle: FixBundle): Promise<FixProposal> {
    return sidecarCall<FixProposal>(this.sidecar, 'POST', '/api/v1/fix/propose', {
      what: 'AI fix agent',
      timeoutMs: FIX_TIMEOUT_MS,
      body: { ...bundle, taxonomy: KB_TAXONOMY_ID[bundle.taxonomy] },
    })
  }
}
