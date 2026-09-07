import { createTylinaCommandRegistry, createTylinaToolDefinitions, createWorkspaceFileToolDefinitions } from 'tylina-sdk/tools'
import type { EditorToolCaller } from './tools'

/** The same command gateway serves Harness tools and external MCP clients. */
export function createHarnessCommands(call: EditorToolCaller) {
  return createTylinaCommandRegistry([...createTylinaToolDefinitions(), ...createWorkspaceFileToolDefinitions()],
    (name, input, context) => call(name, input, context?.signal ?? new AbortController().signal))
}
