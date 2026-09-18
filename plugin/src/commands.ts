import {
  createTylinaCommandRegistry,
  createTylinaToolDefinitions,
  TYLINA_COMMANDS,
  type TylinaCommandDefinitions
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

const commandByOperation = new Map(
  Object.entries(TYLINA_COMMANDS).map(([command, operation]) => [operation, command])
)

export function createHarnessCommandDefinitions(): TylinaCommandDefinitions {
  return [
    ...createTylinaToolDefinitions(),
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
  ]
}

/** The same command gateway serves Harness tools and external MCP clients. */
export function createHarnessCommands(
  call: EditorToolCaller,
  definitions = createHarnessCommandDefinitions()
) {
  return createTylinaCommandRegistry(definitions, (name, input, context) => {
    const command = commandByOperation.get(name)
    if (!command) throw new Error(`Unavailable Tylina operation: ${name}`)
    return call('tylina', { command, args: input }, context?.signal ?? new AbortController().signal)
  })
}
