/**
 * IndasPipelineService: Vashu's Ind AS pipeline (docs/17) over the sidecar's /api/v1/indas/* routes.
 * Excel → canonical sheets (/transform) → tag suggestions (/recommend) → masters (/master-fields) → XML (/generateXML).
 * Electron-free: the sidecar, the output folder and the writer come in as ports. The AI only proposes tags;
 * the renderer sends the tags the user accepted.
 */
import type {
  CanonicalRow,
  ConceptSuggestion,
  GenerateXmlInput,
  GenerateXmlProblem,
  GenerateXmlResult,
  MasterFields,
  StatementLine,
  TransformResult,
} from '@shared/indas'
import { sidecarCall } from '../infra/sidecar-call'
import type { OutputWriter } from './mca-tool-service'
import type { SidecarClient, SidecarFileClient } from './ports'

const BASE = '/api/v1/indas'
/** Keys per /recommend call: small enough to show progress and stay under the request timeout. */
export const RECOMMEND_BATCH = 8
const SLOW_MS = 300_000

interface Envelope<T> {
  data: T
  success: boolean
  message: string
  errors?: { message?: string; type?: string | null }[] | null
}

interface RawMatch {
  metadata?: Record<string, unknown>
  page_content?: string
}

export class IndasPipelineService {
  constructor(
    private readonly sidecar: SidecarClient & SidecarFileClient,
    private readonly output: OutputWriter,
  ) {}

  /** The standard template workbook (.xlsx bytes) — input path 1. */
  async template(): Promise<Uint8Array> {
    await this.sidecar.whenReady(120_000)
    const res = await this.sidecar.download(`${BASE}/template`)
    if (res.status !== 200) throw new Error(`Could not get the template (${res.status})`)
    return res.bytes
  }

  /** Converts a client workbook (or reads a filled template) into the six canonical sheets. */
  async transform(fileName: string, bytes: Uint8Array): Promise<TransformResult> {
    await this.sidecar.whenReady(120_000)
    const res = await this.sidecar.upload<Envelope<{ summary?: Record<string, unknown>; sheets?: Record<string, CanonicalRow[]> }>>(
      `${BASE}/transform`,
      { field: 'file', fileName, bytes },
      SLOW_MS,
    )
    if (res.status !== 200 || !res.data?.success) throw new Error(res.data?.message || `Transformation failed (${res.status})`)
    const summary = res.data.data.summary ?? {}
    return { fileName, source: String(summary.source ?? 'heuristic'), sheets: res.data.data.sheets ?? {}, summary }
  }

  /**
   * Tag suggestions for each key, in key order (an empty list when nothing matched).
   * `onProgress(done, total)` after each batch.
   */
  async recommend(keys: string[], topK = 3, onProgress?: (done: number, total: number) => void): Promise<ConceptSuggestion[][]> {
    const out: ConceptSuggestion[][] = []
    for (let i = 0; i < keys.length; i += RECOMMEND_BATCH) {
      const batch = keys.slice(i, i + RECOMMEND_BATCH)
      const data = await sidecarCall<RawMatch[][]>(this.sidecar, 'POST', `${BASE}/recommend/`, {
        body: { keys: batch, top_k: topK },
        timeoutMs: SLOW_MS,
        what: 'Tag suggestions',
      })
      for (let j = 0; j < batch.length; j++) out.push((data[j] ?? []).map(toSuggestion).filter((s): s is ConceptSuggestion => s !== null))
      onProgress?.(out.length, keys.length)
    }
    return out
  }

  masterFields(): Promise<MasterFields> {
    return sidecarCall<MasterFields>(this.sidecar, 'GET', `${BASE}/master-fields`, { what: 'Master fields' })
  }

  /** Validates and generates the XML; on success it is written to the projects folder. */
  async generate(input: GenerateXmlInput): Promise<GenerateXmlResult> {
    await this.sidecar.whenReady(120_000)
    const res = await this.sidecar.request<Envelope<{ xmlContent?: string; fileSizeKb?: number }>>('POST', `${BASE}/generateXML`, toPayload(input), SLOW_MS)
    if (res.status === 200 && res.data?.success && typeof res.data.data?.xmlContent === 'string') {
      const fileName = xmlFileName(input.companyName, input.meta.endDate)
      const path = await this.output.write(null, fileName, res.data.data.xmlContent)
      return { ok: true, path, fileName, sizeKb: res.data.data.fileSizeKb ?? 0 }
    }
    const errors: GenerateXmlProblem[] = (res.data?.errors ?? []).map((e) => ({ type: e.type ?? null, message: e.message ?? String(e) }))
    if (errors.length === 0) errors.push({ type: null, message: res.data?.message || `XML generation failed (${res.status})` })
    return { ok: false, errors }
  }
}

function toSuggestion(m: RawMatch): ConceptSuggestion | null {
  const md = m.metadata ?? {}
  const qname = typeof md.qname === 'string' ? md.qname : null
  if (!qname) return null
  const labels = md.labels as { label?: string } | undefined
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  return {
    qname,
    label: labels?.label ?? str(md.name) ?? qname,
    score: typeof md.relevance_score === 'number' ? md.relevance_score : 0,
    type: str(md.type),
    periodType: str(md.periodType),
    balance: str(md.balance),
  }
}

/** The /generateXML request body (api/v1/schemas/indas_schema.py → GenerateXML). */
export function toPayload(input: GenerateXmlInput) {
  const lines = (rows: StatementLine[]) => rows.filter((r) => r.concept).map((r) => ({ concept: r.concept, cy: r.cy, py: r.py }))
  const filled = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v.trim() !== ''))
  return {
    meta: { taxonomy: 'ind_as', nature: input.meta.nature, startDate: input.meta.startDate, endDate: input.meta.endDate, unit: 'INR', decimals: '0' },
    master: {
      company: filled(input.master.company),
      auditor: filled(input.master.auditor),
      signatories: input.master.signatories.map((s) => ({
        din: s.din.trim(),
        name: s.name.trim() || undefined,
        designation: s.designation.trim() || 'Director',
        signingDate: s.signingDate || undefined,
      })),
    },
    statements: { balanceSheet: lines(input.statements.balanceSheet), profitLoss: lines(input.statements.profitLoss) },
    tables: [],
    notes: [],
  }
}

/** `<Company>_AOC4_<end date>.xml`, safe on Windows. */
export function xmlFileName(company: string, endDate: string): string {
  const safe = company.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim() || 'Filing'
  return `${safe}_AOC4_${endDate || 'FY'}.xml`
}
