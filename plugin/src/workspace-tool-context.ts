import type { EditorToolCaller } from './tools'

/** The filesystem project path belongs to the Harness host, even when compilation uses WASM. */
export function withWorkspaceToolContext(call: EditorToolCaller, root: string): EditorToolCaller {
  return async (name, input, signal) => {
    signal.throwIfAborted()
    const value = await call(name, input, signal)
    if (!isWorkspaceInfo(name, input) || value.isError || !value.structuredContent) return value
    const data: Record<string, unknown> = { ...value.structuredContent, root }
    return { ...value, structuredContent: data, content: [{
      type: 'text',
      text: [
        `Workspace: ${root}`,
        `Main file: ${String(data.mainFile ?? 'none')}`,
        `Known files: ${String(data.sourceFileCount ?? '?')} Typst source(s), ` +
          `${String(data.resourceFileCount ?? '?')} resource(s)`
      ].join('\n')
    }] }
  }
}

function isWorkspaceInfo(name: string, input: unknown): boolean {
  return name === 'tylina' && Boolean(input) && typeof input === 'object' &&
    (input as { command?: unknown }).command === 'workspace.info'
}
