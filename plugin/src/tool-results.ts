import type { AttachmentStore, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ToolResult } from '@tylina/agent-tools/registry'

interface HarnessToolValue { structuredContent: object | null; content: ContentBlock[] }
const dimensions = { type: 'object', properties: { width: { type: 'integer' }, height: { type: 'integer' } },
  required: ['width', 'height'], additionalProperties: false } as const

export const tylinaToolOutput: ToolDefinition['output'] = {
  schema: { type: 'object', additionalProperties: false, required: ['structuredContent', 'content'], properties: {
    structuredContent: { oneOf: [{ type: 'object' }, { type: 'null' }] },
    content: { type: 'array', items: { oneOf: [
      { type: 'object', additionalProperties: false, required: ['type', 'text'], properties: {
        type: { type: 'string', const: 'text' }, text: { type: 'string' }
      } },
      { type: 'object', additionalProperties: false, required: ['type', 'attachment'], properties: {
        type: { type: 'string', const: 'image' }, attachment: { type: 'object', additionalProperties: false,
          required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height'], properties: {
            attachmentId: { type: 'string' }, mediaType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] },
            bytes: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' }, name: { type: 'string' },
            originalDimensions: { ...dimensions, required: [...dimensions.required] }
          } }
      } }
    ] } }
  } },
  // The released registry validates this exact canonical schema before projecting it.
  render: (_args, value) => (value as unknown as HarnessToolValue).content
}

/** Commit images through the Harness attachment owner before publishing durable tool content. */
export async function admitTylinaToolResult(
  attachments: Pick<AttachmentStore, 'saveImages'>, result: ToolResult, signal: AbortSignal
): Promise<HarnessToolValue> {
  signal.throwIfAborted()
  if (!result || !Array.isArray(result.content) || result.content.length > 32) throw new Error('Invalid Tylina tool result')
  if (result.isError) throw new Error(result.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n').slice(0, 8192) || 'The Tylina tool failed')
  let totalBytes = 0
  const images = []
  for (const part of result.content) {
    if (part.type === 'text' && typeof part.text === 'string') totalBytes += Buffer.byteLength(part.text)
    else if (part.type === 'image' && typeof part.data === 'string' &&
      ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(part.mimeType)) {
      if (part.data.length > Math.ceil((32 * 1024 * 1024 - totalBytes) / 3) * 4) {
        throw new Error('Tylina tool content exceeds the result budget')
      }
      const bytes = Buffer.from(part.data, 'base64')
      if (bytes.toString('base64') !== part.data) throw new Error('Tylina returned invalid image bytes')
      totalBytes += bytes.length
      images.push({ data: bytes, mediaType: part.mimeType as ImageMediaType })
    } else throw new Error('Unsupported Tylina tool content')
    if (totalBytes > 32 * 1024 * 1024) throw new Error('Tylina tool content exceeds the result budget')
  }
  const saved = images.length ? await attachments.saveImages(images) : []
  signal.throwIfAborted()
  let imageIndex = 0
  return { structuredContent: result.structuredContent ?? null,
    content: result.content.map((part): ContentBlock => part.type === 'text'
      ? { type: 'text', text: part.text } : { type: 'image', attachment: saved[imageIndex++] }) }
}
