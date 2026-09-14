import { createTylinaCommandRegistry, createTylinaToolDefinitions, createWorkspaceFileToolDefinitions } from 'tylina-sdk/tools'
import type { EditorToolCaller } from './tools'

// The optional third parameter is ignored by older published SDKs and activates when the
// matching Tylina 0.15 SDK is staged or installed.
const createCommandRegistry = createTylinaCommandRegistry as (
  definitions: Parameters<typeof createTylinaCommandRegistry>[0],
  call: Parameters<typeof createTylinaCommandRegistry>[1],
  options?: { includeFileRead?: boolean }
) => ReturnType<typeof createTylinaCommandRegistry>

/** The same command gateway serves Harness tools and external MCP clients. */
export function createHarnessCommands(call: EditorToolCaller) {
  return createCommandRegistry([
    ...createTylinaToolDefinitions(),
    ...createWorkspaceFileToolDefinitions().filter(tool =>
      ['tylina_save_workspace', 'tylina_read_file'].includes(tool.name))
  ], (name, input, context) =>
    call(name, input, context?.signal ?? new AbortController().signal), {
    includeFileRead: true
  })
}
