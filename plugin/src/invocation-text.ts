const MAX_PRESENTATION_LENGTH = 4096
const MAX_VALUE_LENGTH = 512
const MAX_RESULT_LENGTH = 64 * 1024

export const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined

export function parseInput(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) }
  catch { return value }
}

export function bounded(value: string, limit = MAX_PRESENTATION_LENGTH): string {
  if (value.length <= limit) return value
  return `${value.slice(0, Math.max(0, limit - 38)).trimEnd()}\n… [tool input truncated]`
}

export function label(value: string): string {
  return value
    .replaceAll(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replaceAll(/[_-]+/gu, ' ')
    .replace(/^./u, (character) => character.toUpperCase())
}

export function scalar(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (typeof value !== 'string') return String(value)
  const normalized = value.replaceAll(/\s+/gu, ' ').trim()
  if (normalized.length <= MAX_VALUE_LENGTH) return normalized || '(empty)'
  return `${normalized.slice(0, MAX_VALUE_LENGTH - 25).trimEnd()}… (${value.length} characters)`
}

/**
 * Historical DSH rows do not retain the canonical value beside their text.
 * Only rewrite a parsed object when its shape is recognisably one of the old
 * Tylina envelopes; arbitrary authored JSON must remain authored text.
 */
export function isLikelyLegacyResult(
  command: string,
  value: Record<string, unknown>
): boolean {
  const has = (...keys: string[]) => keys.some((key) => Object.hasOwn(value, key))
  const hasBoolean = (...keys: string[]) => keys.some((key) => typeof value[key] === 'boolean')
  const hasString = (...keys: string[]) => keys.some((key) => typeof value[key] === 'string')
  const hasArray = (...keys: string[]) => keys.some((key) => Array.isArray(value[key]))
  switch (command) {
    case 'help': return Array.isArray(value.commands) || has('usage')
    case 'skill.list': return Array.isArray(value.skills) || has('installedSkillsAvailable')
    case 'presenter': return has('stage', 'operationId', 'audienceFullscreen', 'page')
    case 'view.state':
    case 'view.set':
      return has('mode', 'slides', 'workspace', 'workspaceView', 'sidebarTool', 'agent', 'terminal', 'templates', 'history', 'zoom')
    case 'editor.state': return has('mode', 'surface', 'mainFile', 'activeFile', 'selectionStatus', 'selection')
    case 'workspace.save': return hasBoolean('saved') || has('persistenceError')
    case 'workspace.info': return has('root') && has('mainFile', 'sourceFileCount', 'resourceFileCount')
    case 'document.setMain': return hasBoolean('valid') && hasString('mainFile')
    case 'document.export': return hasString('format') && (hasArray('paths') || hasString('mainFile'))
    case 'document.import': return hasString('status') && has('source', 'destination', 'receipt', 'write', 'warnings')
    case 'document.validate': return hasBoolean('valid') && has('mainFile', 'diagnostics', 'error', 'diagnosticCount')
    case 'document.eval': return hasBoolean('valid') && has('mainFile', 'value', 'warnings', 'error')
    case 'document.outline': return hasBoolean('valid') && has('mainFile', 'headings', 'headingCount', 'error')
    case 'document.targets': return hasBoolean('valid') && has('mainFile', 'sourceFile', 'targets', 'targetCount', 'error')
    case 'render.summary': return hasBoolean('valid') && has('mainFile', 'pageCount', 'pages', 'error')
    case 'render.overview': return hasBoolean('valid') && has('mainFile', 'totalPageCount', 'pages', 'error')
    case 'render.page': return hasBoolean('valid') && has('mainFile', 'page', 'imageSizePixels', 'pageSizePoints', 'error')
    case 'template.list': return hasBoolean('available') && has('templates', 'catalogCount', 'matchedCount', 'source', 'error')
    case 'template.inspect': return hasBoolean('available') && has('template', 'spec', 'documentation', 'entrypoint', 'error')
    case 'template.create': return hasBoolean('available') && has('spec', 'destination', 'createdFiles', 'entrypoint', 'error')
    case 'package.list': return hasBoolean('available') && has('packages', 'catalogCount', 'matchedCount', 'source', 'error')
    case 'package.inspect': return hasBoolean('available') && has('package', 'spec', 'documentation', 'entrypoint', 'error')
    case 'image.search': return hasBoolean('available') && has('results', 'query', 'matchedCount', 'page', 'error')
    case 'image.import': return hasString('destination') && has('sourcePageUrl', 'license', 'attribution', 'write')
    case 'skill.read': return false
    default: return false
  }
}

function renderValue(value: unknown, depth = 0): string {
  if (depth >= 3) return scalar(value)
  if (Array.isArray(value)) {
    const shown = value.slice(0, 12).map((entry) => `- ${renderValue(entry, depth + 1)}`)
    if (value.length > shown.length) shown.push(`- … ${value.length - shown.length} more`)
    return shown.join('\n') || '(empty list)'
  }
  const object = record(value)
  if (!object) return scalar(value)
  const entries = Object.entries(object).filter(([key]) => key !== '_meta').slice(0, 24)
  const lines = entries.map(([key, entry]) => {
    const rendered = renderValue(entry, depth + 1)
    return rendered.includes('\n')
      ? `${label(key)}:\n${rendered.split('\n').map((line) => `  ${line}`).join('\n')}`
      : `${label(key)}: ${rendered}`
  })
  if (Object.keys(object).length > entries.length) lines.push('… more fields omitted')
  return lines.join('\n') || '(empty object)'
}

function renderResultValue(value: unknown, depth = 0): string {
  if (depth >= 5) return scalar(value)
  if (Array.isArray(value)) {
    const shown = value.slice(0, 40).map((entry) => {
      const rendered = renderResultValue(entry, depth + 1)
      return rendered.includes('\n')
        ? `-\n${rendered.split('\n').map((line) => `  ${line}`).join('\n')}`
        : `- ${rendered}`
    })
    if (value.length > shown.length) shown.push(`- … ${value.length - shown.length} more`)
    return shown.join('\n') || '(empty list)'
  }
  const object = record(value)
  if (!object) return scalar(value)
  const entries = Object.entries(object).filter(([key]) => key !== '_meta').slice(0, 40)
  const lines = entries.map(([key, entry]) => {
    const rendered = renderResultValue(entry, depth + 1)
    return rendered.includes('\n')
      ? `${label(key)}:\n${rendered.split('\n').map((line) => `  ${line}`).join('\n')}`
      : `${label(key)}: ${rendered}`
  })
  if (Object.keys(object).length > entries.length) lines.push('… more fields omitted')
  return lines.join('\n') || '(empty object)'
}

/** Bounded readable input for old SDKs; canonical arguments remain untouched in the Harness log. */
export function renderCompatibleInvocation(name: string, input: unknown): string {
  const value = parseInput(input)
  const request = record(value)
  if (name === 'tylina' && typeof request?.command === 'string') {
    const args = record(request.args)
    return bounded([
      `Command: ${request.command}`,
      args && Object.keys(args).length ? `Arguments:\n${renderValue(args)}` : 'Arguments: none'
    ].join('\n'))
  }
  return bounded(`${label(name)} arguments:\n${renderValue(value)}`)
}

/** Semantic result projection shared by the legacy model adapter and historical DSH rows. */
export function renderCompatibleResult(command: string, value: object): string {
  const result = record(value) ?? {}
  if (command === 'skill.read') {
    const content = typeof result.content === 'string' ? result.content : ''
    return bounded([
      `Skill resource: ${scalar(result.path)}`,
      ...(typeof result.bytes === 'number' ? [`Bytes: ${result.bytes}`] : []),
      '',
      content
    ].join('\n'), MAX_RESULT_LENGTH)
  }
  if (command === 'document.validate') {
    const valid = result.valid === true
    return bounded([
      valid ? 'Document is valid.' : 'Document is not valid.',
      ...(result.mainFile ? [`Main file: ${scalar(result.mainFile)}`] : []),
      ...(Array.isArray(result.diagnostics) && result.diagnostics.length
        ? ['', 'Diagnostics:', renderResultValue(result.diagnostics)]
        : [])
    ].join('\n'), MAX_RESULT_LENGTH)
  }
  if (command === 'document.export') {
    const paths = Array.isArray(result.paths) ? result.paths.map(scalar) : []
    return bounded([
      `Export: ${scalar(result.format ?? 'complete')}`,
      ...(paths.length ? ['Files:', ...paths.map((path) => `- ${path}`)] : [])
    ].join('\n'), MAX_RESULT_LENGTH)
  }
  if (command === 'render.page') {
    const pixels = record(result.imageSizePixels)
    const points = record(result.pageSizePoints)
    const renderedPage = result.mainFile
      ? `Rendered page ${scalar(result.page ?? '?')} of ${scalar(result.mainFile)}` +
        `${result.ppi !== undefined ? ` at ${scalar(result.ppi)} PPI` : ''}.`
      : `Rendered page: ${scalar(result.page ?? '?')}` +
        `${result.pageCount !== undefined ? `/${scalar(result.pageCount)}` : ''}.`
    return bounded([
      renderedPage,
      ...(pixels?.width !== undefined && pixels.height !== undefined
        ? [`Image: ${scalar(pixels.width)} × ${scalar(pixels.height)} px`]
        : result.width !== undefined && result.height !== undefined
          ? [`Image: ${scalar(result.width)} × ${scalar(result.height)} px`]
          : []),
      ...(points?.width !== undefined && points.height !== undefined
        ? [`Page: ${scalar(points.width)} × ${scalar(points.height)} pt`]
        : [])
    ].join('\n'), MAX_RESULT_LENGTH)
  }
  return bounded(renderResultValue(result), MAX_RESULT_LENGTH)
}
