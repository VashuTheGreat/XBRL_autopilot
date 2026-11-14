/** DocxConverter adapter (docs/14 Step 6): Word → HTML with mammoth. Images are not kept (MCA text blocks have none). */
import mammoth from 'mammoth'
import type { DocxConverter } from '../services/ports'

export class MammothDocxConverter implements DocxConverter {
  async toHtml(bytes: Uint8Array): Promise<{ html: string; messages: string[] }> {
    const result = await mammoth.convertToHtml(
      { buffer: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) },
      { convertImage: mammoth.images.imgElement(async () => ({ src: '' })) },
    )
    return { html: result.value, messages: result.messages.map((m) => m.message) }
  }
}
