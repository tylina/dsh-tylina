import {
  createTylinaCommandRegistry,
  createTylinaToolDefinitions,
  TYLINA_COMMANDS
} from 'tylina-sdk/tools'
import type { EditorToolCaller } from './tools'

type CommandInputSchema = Parameters<
  typeof createTylinaCommandRegistry
>[0][number]['inputSchema']

const noArgumentsSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false
} as unknown as CommandInputSchema

/** The same command gateway serves Harness tools and external MCP clients. */
export function createHarnessCommands(call: EditorToolCaller) {
  const definitions = createTylinaToolDefinitions()
  return createTylinaCommandRegistry([
    ...definitions,
    {
      name: TYLINA_COMMANDS['workspace.save'],
      description: 'Persist the current canonical workspace, including pending human edits.',
      inputSchema: noArgumentsSchema,
      annotations: {
        title: 'Save workspace',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    }
  ], (name, input, context) =>
    call(name, input, context?.signal ?? new AbortController().signal))
}
