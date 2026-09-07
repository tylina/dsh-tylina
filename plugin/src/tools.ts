import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-attachment'
import { createHarnessCommands } from './commands'
import type { ToolResult } from 'tylina-sdk/tools'
import { admitTylinaToolResult, tylinaToolOutput } from './tool-results'

export type EditorToolCaller = (name: string, input: unknown, signal: AbortSignal) => Promise<ToolResult>

/** The supplied context is the resolved Agent's scope; the caller identity is checked again at dispatch. */
export function registerTylinaEditorTools(ctx: Context, sessionId: string, call: EditorToolCaller): () => void {
  const dispose: Array<() => void> = []
  let active = true
  const stop = () => { active = false; dispose.splice(0).reverse().forEach((release) => release()) }
  try {
    const commands = createHarnessCommands(call)
    for (const tool of commands.definitions()) {
      dispose.push(ctx.tools.register({ name: tool.name, description: tool.description, parameters: tool.inputSchema,
        output: tylinaToolOutput,
        async execute(input, exec) {
          exec.signal.throwIfAborted()
          if (!active || exec.agent?.id !== sessionId) throw new Error('This Tylina editor is not connected to the calling Harness session')
          const result = await commands.call(tool.name, input, { signal: exec.signal })
          return admitTylinaToolResult(ctx.attachments, result, exec.signal)
        }
      }))
    }
    return stop
  } catch (error) { stop(); throw error }
}
