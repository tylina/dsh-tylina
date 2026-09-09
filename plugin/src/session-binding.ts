import type {} from '@deepseek-ai/dsh-system-prompt'
import { createTylinaMcpSessionInstructions } from 'tylina-sdk/tools'
import { loadTylinaMcpCoreSkillInstructions } from 'tylina-sdk/tools'
import { registerTylinaEditorTools, type EditorToolCaller } from './tools'
import type { createHarnessWorkspaces } from './workspaces'
import type { TylinaToolRuntime } from 'tylina-sdk/node'
import { withHarnessToolRuntime } from './tool-runtime'
import type { createHarnessMcpEndpoints } from './mcp'

/** The ordinary Harness Agent owns chat/model/keys; Tylina contributes its live document and authoring contract. */
export function createSessionBinder(workspaces: ReturnType<typeof createHarnessWorkspaces>, skillsRootPath: string,
  runtime: TylinaToolRuntime, mcp: ReturnType<typeof createHarnessMcpEndpoints>) {
  let core: Promise<string> | undefined
  return async (sessionId: string, call: EditorToolCaller, signal: AbortSignal, project = '') => {
    const { agent, path } = await workspaces.resolve(sessionId, project, signal)
    const instructions = await (core ??= loadTylinaMcpCoreSkillInstructions({ skillsRootPath }))
    const contract = createTylinaMcpSessionInstructions(instructions, 'memory')
    const connected = `Tylina is connected to this session's document project at ${path}. ` +
      'Its file tools use paths relative to that project. ' +
      'This current Tylina contract supersedes earlier Tylina instructions and connection notices. ' +
      'Read and change the live document through Tylina tools so unsaved user edits and Undo are retained. ' +
      'Other filesystem tools and scripts use the Harness working directory and their edits arrive as external changes. ' +
      'Do not infer that a disconnected tool completed or retry an uncertain write without inspecting the current document.'
    signal.throwIfAborted()
    const execute = withHarnessToolRuntime(call, runtime, path, skillsRootPath)
    const pending = new Set<ReturnType<EditorToolCaller>>()
    const invoke: EditorToolCaller = (name, input, callerSignal) => {
      const task = Promise.resolve().then(() => execute(name, input, AbortSignal.any([signal, callerSignal])))
      pending.add(task)
      void task.finally(() => pending.delete(task)).catch(() => undefined)
      return task
    }
    let endpoint: ReturnType<typeof mcp.open> | undefined
    let unregister: (() => void) | undefined
    const owner = agent.ctx.inject(['tools', 'attachments', 'systemPrompt'], (context) => {
      unregister = registerTylinaEditorTools(context, sessionId, invoke)
      // Harness owns snapshot deduplication, persistence and restoration after compaction.
      // The scoped provider is removed with this connection; reconnecting does not enqueue chat.
      context.systemPrompt.context({ name: 'tylina', order: 500, text: `${connected}\n\n${contract}` })
    })
    const dispose = async () => {
      unregister?.()
      const closing = endpoint?.dispose()
      // Include Node-owned runtime requests, which do not pass through the editor socket.
      await Promise.allSettled([...pending])
      await closing
      await owner.dispose()
    }
    try {
      await owner
      signal.throwIfAborted()
      if (!unregister) throw new Error('The Harness Agent tool services are unavailable')
      endpoint = mcp.open(invoke, `${connected}\n\n${contract}`, signal)
      return { dispose, mcp: endpoint.connection }
    } catch (error) { await dispose(); throw error }
  }
}
