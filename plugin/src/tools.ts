import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-attachment'
import * as sdkTools from 'tylina-sdk/tools'
import type { ToolResult } from 'tylina-sdk/tools'
import { createHarnessCommandDefinitions, createHarnessCommands } from './commands'
import { admitTylinaToolResult, tylinaToolOutput } from './tool-results'
import {
  describeCompatibleInvocation,
  projectCompatibleResult,
  renderCompatibleInvocation
} from './tool-presentation'

type PresentationSdk = {
  describeTylinaCommandInvocation?: typeof describeCompatibleInvocation
  renderToolInvocation?: typeof renderCompatibleInvocation
  renderTylinaToolResult?: (name: string, value: object) => string
}
const presentationSdk = sdkTools as PresentationSdk

export type EditorToolCaller = (name: string, input: unknown, signal: AbortSignal) => Promise<ToolResult>

/** The supplied context is the resolved Agent's scope; the caller identity is checked again at dispatch. */
export function registerTylinaEditorTools(ctx: Context, sessionId: string, call: EditorToolCaller): () => void {
  const dispose: Array<() => void> = []
  let active = true
  const stop = () => { active = false; dispose.splice(0).reverse().forEach((release) => release()) }
  try {
    const operations = createHarnessCommandDefinitions()
    const commands = createHarnessCommands(call, operations)
    for (const tool of commands.definitions()) {
      dispose.push(ctx.tools.register({ name: tool.name, description: tool.description, parameters: tool.inputSchema,
        output: tylinaToolOutput,
        presentCall(input) {
          const invocation = (presentationSdk.describeTylinaCommandInvocation ?? describeCompatibleInvocation)(
            operations,
            tool.name,
            input
          )
          return {
            card: 'generic',
            title: invocation?.title ?? tool.annotations.title,
            kind: invocation?.readOnlyHint === true
              ? 'read'
              : invocation?.readOnlyHint === false
                ? 'edit'
                : 'other',
            rawInput: (presentationSdk.renderToolInvocation ?? renderCompatibleInvocation)(tool.name, input)
          }
        },
        async execute(input, exec) {
          exec.signal.throwIfAborted()
          if (!active || exec.agent?.id !== sessionId) throw new Error('This Tylina editor is not connected to the calling Harness session')
          const result = await commands.call(tool.name, input, { signal: exec.signal })
          return admitTylinaToolResult(
            ctx.attachments,
            projectCompatibleResult(input, result, presentationSdk.renderTylinaToolResult),
            exec.signal
          )
        }
      }))
    }
    return stop
  } catch (error) { stop(); throw error }
}
