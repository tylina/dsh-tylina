import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  isLikelyLegacyResult,
  parseInput,
  record,
  renderCompatibleInvocation,
  renderCompatibleResult
} from '../invocation-text'

interface CallInput {
  command?: string
  args?: Record<string, unknown>
}

function parseCall(argsRaw: string): CallInput | undefined {
  try {
    const value = JSON.parse(argsRaw)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as CallInput : undefined
  } catch { return undefined }
}

function firstLine(value: string): string {
  return value.split('\n', 1)[0].slice(0, 240)
}

function contentParts(block: ToolCallViewProps['block']): readonly unknown[] {
  return 'kind' in block && Array.isArray(block.content) ? block.content : []
}

function resultText(block: ToolCallViewProps['block'], command: string): string | null {
  const parts = contentParts(block)
    .filter((part): part is { type: 'text'; text: string } =>
      Boolean(part && typeof part === 'object' && (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string'))
  if (parts.length === 1 && command !== 'skill.read') {
    const legacy = record(parseInput(parts[0].text))
    if (legacy && isLikelyLegacyResult(command, legacy)) {
      return renderCompatibleResult(command, legacy)
    }
  }
  return parts.map((part) => part.text).join('\n') || null
}

function imageCount(block: ToolCallViewProps['block']): number {
  return contentParts(block).filter((part) =>
    part && typeof part === 'object' && (part as { type?: unknown }).type === 'image').length
}

function callModel(block: ToolCallViewProps['block'], callId: string) {
  const settled = 'kind' in block
  const argsRaw = (settled ? block.call?.argsRaw : block.argsRaw) ?? ''
  const input = parseCall(argsRaw)
  const command = typeof input?.command === 'string' ? input.command : 'Tylina'
  const output = resultText(block, command)
  const images = imageCount(block)
  const state = !settled
    ? 'running'
    : block.error?.code === 'interrupted'
      ? 'stopped'
      : block.isError
        ? 'error'
        : 'ok'
  return {
    command,
    input: argsRaw ? renderCompatibleInvocation('tylina', input ?? argsRaw) : null,
    output,
    images,
    state,
    fallbackSummary: callId
  }
}

/** A replay-safe Tylina row that never prints structured attachment or canonical JSON objects. */
export function TylinaToolView({ block, callId, inspect, t }: ToolCallViewProps & PropsLocale<'tylina'>) {
  const model = callModel(block, callId)
  const expandable = Boolean(model.input || model.output || model.images || inspect)
  const summary = model.output
    ? firstLine(model.output)
    : model.images > 0
      ? t('toolImages', { count: model.images })
      : model.fallbackSummary
  return <details className="tylina-tool-card" data-state={model.state}>
    <summary className="tylina-tool-summary" aria-disabled={!expandable || undefined}>
      <span className="tylina-tool-icon" aria-hidden="true">
        <img src="/tylina/favicon.svg" width="14" height="14" alt="" />
      </span>
      <span className="tylina-tool-title">{model.command}</span>
      <span className="tylina-tool-separator" aria-hidden="true" />
      <span className="tylina-tool-description">{summary}</span>
      <span className="tylina-tool-state" aria-label={model.state} />
    </summary>
    {expandable && <div className="tylina-tool-details">
      {model.input && <section>
        <strong>{t('toolInput')}</strong>
        <pre>{model.input}</pre>
      </section>}
      {(model.output || model.images > 0) && <section>
        <strong>{t('toolOutput')}</strong>
        {model.output && <pre>{model.output}</pre>}
        {model.images > 0 && <p>{t('toolImages', { count: model.images })}</p>}
      </section>}
      {inspect && <button type="button" className="tylina-tool-inspect" onClick={inspect}>{t('toolInspect')}</button>}
    </div>}
  </details>
}

export function registerTylinaToolView(ctx: Context) {
  return ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'tylina',
    locale: 'tylina'
  }, TylinaToolView))
}
