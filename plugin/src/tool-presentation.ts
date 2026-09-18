import { TYLINA_COMMANDS, type ToolResult, type TylinaCommandDefinitions } from 'tylina-sdk/tools'
import { parseInput, record, renderCompatibleInvocation, renderCompatibleResult } from './invocation-text'
export { renderCompatibleInvocation, renderCompatibleResult } from './invocation-text'

interface InvocationPresentation {
  title: string
  readOnlyHint: boolean
}

/** Compatibility projection for SDKs released before the shared presentation helpers. */
export function describeCompatibleInvocation(
  operations: TylinaCommandDefinitions,
  name: string,
  input: unknown
): InvocationPresentation | undefined {
  if (name !== 'tylina') return operations.find((tool) => tool.name === name)?.annotations
  const request = record(parseInput(input))
  if (typeof request?.command !== 'string') return undefined
  if (request.command === 'help' || request.command === 'skill.list') {
    return { title: 'Discover Tylina capabilities', readOnlyHint: true }
  }
  const operation = TYLINA_COMMANDS[request.command]
  return operation ? operations.find((tool) => tool.name === operation)?.annotations : undefined
}

function sameJsonValue(left: unknown, right: unknown, depth = 0): boolean {
  if (Object.is(left, right)) return true
  if (depth >= 32 || typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
    return false
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((entry, index) => sameJsonValue(entry, right[index], depth + 1))
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const keys = Object.keys(leftRecord)
  return keys.length === Object.keys(rightRecord).length &&
    keys.every((key) => Object.hasOwn(rightRecord, key) && sameJsonValue(leftRecord[key], rightRecord[key], depth + 1))
}

function legacyJsonContent(result: ToolResult): boolean {
  const text = result.content.filter((part) => part.type === 'text')
  if (text.length !== 1 || !result.structuredContent) return false
  try { return sameJsonValue(JSON.parse(text[0].text), result.structuredContent) }
  catch { return false }
}

/** Replace only the legacy JSON envelope; authored text and newer readable projections pass through. */
export function projectCompatibleResult(
  input: unknown,
  result: ToolResult,
  sharedRenderer?: (name: string, value: object) => string
): ToolResult {
  if (!result.structuredContent || !legacyJsonContent(result)) return result
  const request = record(parseInput(input))
  const command = typeof request?.command === 'string' ? request.command : 'tylina'
  const operation = TYLINA_COMMANDS[command]
  const text = operation && sharedRenderer
    ? sharedRenderer(operation, result.structuredContent)
    : renderCompatibleResult(command, result.structuredContent)
  let emittedText = false
  return { ...result, content: result.content.flatMap((part): ToolResult['content'] => {
    if (part.type !== 'text') return [part]
    if (emittedText) return []
    emittedText = true
    return [{ type: 'text' as const, text }]
  }) }
}
