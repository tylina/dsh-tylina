import type { EditorToolCaller } from './tools'
import toolNames from 'tylina-sdk/tool-names.json' with { type: 'json' }

/** File and Skill paths belong to the Harness host, even when compilation uses WASM. */
export function withWorkspaceToolContext(call: EditorToolCaller, root: string, skillsRoot: string): EditorToolCaller {
  return async (name, input, signal) => {
    signal.throwIfAborted()
    const value = await call(name, input, signal)
    if (name !== toolNames.workspaceInfo || value.isError || !value.structuredContent) return value
    const data = { ...value.structuredContent, root, skillsRoot }
    return { ...value, structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] }
  }
}
