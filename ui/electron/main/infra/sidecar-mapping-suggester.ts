/** MappingSuggester over the sidecar's POST /api/v1/mapping/suggest (src/services/tagging). */
import type { MappingSuggester, SidecarClient, SuggestRequest, SuggestResponse } from '../services/ports'
import { sidecarCall } from './sidecar-call'
import { KB_TAXONOMY_ID } from './sidecar-taxonomy-catalog'

export class SidecarMappingSuggester implements MappingSuggester {
  constructor(
    private readonly sidecar: SidecarClient,
    private readonly readyTimeoutMs = 120_000,
  ) {}

  suggest(req: SuggestRequest): Promise<SuggestResponse> {
    return sidecarCall<SuggestResponse>(this.sidecar, 'POST', '/api/v1/mapping/suggest', {
      readyTimeoutMs: this.readyTimeoutMs,
      what: 'Auto-tagging',
      body: {
        taxonomy: KB_TAXONOMY_ID[req.taxonomy],
        sheets: req.sheets,
        periods: req.periods,
        level: req.level,
        memory: req.memory,
        options: { useLlm: req.useLlm },
      },
    })
  }
}
