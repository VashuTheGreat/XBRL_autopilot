import { describe, expect, it } from 'vitest'
import type { GenerateXmlInput } from '@shared/indas'
import type { HttpMethod, SidecarResponse } from '@shared/ipc'
import { IndasPipelineService, RECOMMEND_BATCH, toPayload, xmlFileName } from '../electron/main/services/indas-pipeline-service'
import type { SidecarClient, SidecarFileClient } from '../electron/main/services/ports'

type Call = { method: string; path: string; body?: unknown }

/** A fake sidecar answering the /indas routes like api/v1/routes/indas_router.py. */
function fakeSidecar(answers: Partial<Record<string, (body: unknown) => SidecarResponse<unknown>>> = {}) {
  const calls: Call[] = []
  const sidecar: SidecarClient & SidecarFileClient = {
    whenReady: async () => {},
    request: async <T,>(method: HttpMethod, path: string, body?: unknown) => {
      calls.push({ method, path, body })
      const answer = answers[path]
      if (!answer) return { status: 404, data: { success: false, message: 'no route' } as T }
      return answer(body) as SidecarResponse<T>
    },
    upload: async <T,>(path: string, file: { field: string; fileName: string; bytes: Uint8Array }) => {
      calls.push({ method: 'UPLOAD', path, body: file })
      return answers[path]!(file) as SidecarResponse<T>
    },
    download: async (path: string) => {
      calls.push({ method: 'DOWNLOAD', path })
      return { status: 200, bytes: new Uint8Array([80, 75]) }
    },
  }
  return { sidecar, calls }
}

const ok = <T,>(data: T) => ({ status: 200, data: { success: true, message: 'ok', data } })
const writer = () => {
  const written: { name: string; text: string }[] = []
  return { written, write: async (_p: string | null, name: string, text: string) => (written.push({ name, text }), `C:/Projects/${name}`) }
}

const input = (over: Partial<GenerateXmlInput> = {}): GenerateXmlInput => ({
  meta: { nature: 'Standalone', startDate: '2025-04-01', endDate: '2026-03-31' },
  master: { company: { 'in-ca:NameOfCompany': 'Acme Pvt Ltd', 'in-ca:TypeOfIndustry': ' ' }, auditor: {}, signatories: [{ din: ' 01234567 ', name: 'A B', designation: '' }] },
  statements: { balanceSheet: [{ concept: 'ind-as:EquityShareCapital', cy: 417830, py: 390220 }, { concept: '', cy: 1, py: 1 }], profitLoss: [] },
  companyName: 'Acme Pvt Ltd',
  ...over,
})

describe('IndasPipelineService', () => {
  it('downloads the standard template', async () => {
    const { sidecar, calls } = fakeSidecar()
    const bytes = await new IndasPipelineService(sidecar, writer()).template()
    expect([...bytes]).toEqual([80, 75])
    expect(calls).toEqual([{ method: 'DOWNLOAD', path: '/api/v1/indas/template' }])
  })

  it('uploads the workbook as the "file" field and returns the canonical sheets', async () => {
    const { sidecar, calls } = fakeSidecar({
      '/api/v1/indas/transform': () => ok({ summary: { source: 'standard_template' }, sheets: { CANONICAL_BS: [{ Line_Item: 'Share capital' }] } }),
    })
    const t = await new IndasPipelineService(sidecar, writer()).transform('fs.xlsx', new Uint8Array([1]))
    expect(t).toMatchObject({ fileName: 'fs.xlsx', source: 'standard_template', sheets: { CANONICAL_BS: [{ Line_Item: 'Share capital' }] } })
    expect(calls[0].body).toMatchObject({ field: 'file', fileName: 'fs.xlsx' })
  })

  it('reports a failed transformation with the sidecar message', async () => {
    const { sidecar } = fakeSidecar({ '/api/v1/indas/transform': () => ({ status: 500, data: { success: false, message: 'Transformation failed: bad sheet' } }) })
    await expect(new IndasPipelineService(sidecar, writer()).transform('x.xls', new Uint8Array())).rejects.toThrow('bad sheet')
  })

  it('asks for suggestions in batches, keeps them aligned to the keys and reports progress', async () => {
    const keys = Array.from({ length: RECOMMEND_BATCH + 2 }, (_, i) => `k${i}`)
    const { sidecar, calls } = fakeSidecar({
      '/api/v1/indas/recommend/': (body) =>
        ok(
          (body as { keys: string[] }).keys.map((k) =>
            k === 'k1' ? [] : [{ metadata: { qname: `ind-as:${k}`, relevance_score: 0.9, labels: { label: `Label ${k}` }, type: 'monetaryItemType' } }, { metadata: {} }],
          ),
        ),
    })
    const progress: number[] = []
    const out = await new IndasPipelineService(sidecar, writer()).recommend(keys, 3, (done) => progress.push(done))
    expect(calls.map((c) => (c.body as { keys: string[] }).keys.length)).toEqual([RECOMMEND_BATCH, 2])
    expect(out).toHaveLength(keys.length)
    expect(out[0]).toEqual([{ qname: 'ind-as:k0', label: 'Label k0', score: 0.9, type: 'monetaryItemType', periodType: null, balance: null }])
    expect(out[1]).toEqual([]) // nothing matched; a match without a qname is dropped
    expect(progress).toEqual([RECOMMEND_BATCH, keys.length])
  })

  it('writes the generated XML to the projects folder', async () => {
    const out = writer()
    const { sidecar, calls } = fakeSidecar({ '/api/v1/indas/generateXML': () => ok({ xmlContent: '<xbrl/>', fileSizeKb: 1.2 }) })
    const r = await new IndasPipelineService(sidecar, out).generate(input())
    expect(r).toEqual({ ok: true, path: 'C:/Projects/Acme Pvt Ltd_AOC4_2026-03-31.xml', fileName: 'Acme Pvt Ltd_AOC4_2026-03-31.xml', sizeKb: 1.2 })
    expect(out.written).toEqual([{ name: 'Acme Pvt Ltd_AOC4_2026-03-31.xml', text: '<xbrl/>' }])
    expect(calls[0].body).toEqual(toPayload(input()))
  })

  it('returns the MCA problems when validation refuses, and writes nothing', async () => {
    const out = writer()
    const { sidecar } = fakeSidecar({
      '/api/v1/indas/generateXML': () => ({
        status: 422,
        data: { success: false, message: 'statutory validation failed', errors: [{ message: 'Mandatory company identification field missing: CIN', type: 'MANDATORY_COMPANY_INFO_MISSING' }] },
      }),
    })
    const r = await new IndasPipelineService(sidecar, out).generate(input())
    expect(r).toEqual({ ok: false, errors: [{ type: 'MANDATORY_COMPANY_INFO_MISSING', message: 'Mandatory company identification field missing: CIN' }] })
    expect(out.written).toEqual([])
  })

  it('turns a failure without details into one problem', async () => {
    const { sidecar } = fakeSidecar({ '/api/v1/indas/generateXML': () => ({ status: 500, data: { success: false, message: 'XML generation failed: boom' } }) })
    expect(await new IndasPipelineService(sidecar, writer()).generate(input())).toEqual({ ok: false, errors: [{ type: null, message: 'XML generation failed: boom' }] })
  })
})

describe('toPayload', () => {
  it('matches the GenerateXML schema: untagged lines and blank master values dropped, DINs trimmed', () => {
    const p = toPayload(input())
    expect(p.statements.balanceSheet).toEqual([{ concept: 'ind-as:EquityShareCapital', cy: 417830, py: 390220 }])
    expect(p.master.company).toEqual({ 'in-ca:NameOfCompany': 'Acme Pvt Ltd' })
    expect(p.master.signatories).toEqual([{ din: '01234567', name: 'A B', designation: 'Director', signingDate: undefined }])
    expect(p.meta).toEqual({ taxonomy: 'ind_as', nature: 'Standalone', startDate: '2025-04-01', endDate: '2026-03-31', unit: 'INR', decimals: '0' })
  })
})

describe('xmlFileName', () => {
  it('is safe on Windows', () => {
    expect(xmlFileName('A/B: "Co"  Ltd', '2026-03-31')).toBe('AB Co Ltd_AOC4_2026-03-31.xml')
    expect(xmlFileName('  ', '')).toBe('Filing_AOC4_FY.xml')
  })
})
