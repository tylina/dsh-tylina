import { createUserMessage, type Message } from '@deepseek-ai/dsh-llm/message'
import { createTylinaMcpSessionInstructions } from 'tylina-sdk/tools'
import { loadTylinaMcpCoreSkillInstructions } from 'tylina-sdk/tools'
import { registerTylinaEditorTools, type EditorToolCaller } from './tools'
import type { createHarnessWorkspaces } from './workspaces'
import type { TylinaToolRuntime } from 'tylina-sdk/node'
import { withHarnessToolRuntime } from './tool-runtime'
import type { createHarnessMcpEndpoints } from './mcp'

const isCore = (message: Message) => message.source.kind === 'plugin' &&
  message.source.plugin === 'tylina' && message.source.form === 'instructions'

/** The ordinary Harness Agent owns chat/model/keys; Tylina contributes its live document and authoring contract. */
export function createSessionBinder(workspaces: ReturnType<typeof createHarnessWorkspaces>, skillsRootPath: string,
  runtime: TylinaToolRuntime, mcp: ReturnType<typeof createHarnessMcpEndpoints>) {
  let core: Promise<string> | undefined
  return async (sessionId: string, call: EditorToolCaller, signal: AbortSignal, project = '') => {
    const { agent, store } = await workspaces.resolve(sessionId, project, signal)
    const instructions = await (core ??= loadTylinaMcpCoreSkillInstructions({ skillsRootPath }))
    const coreMessage = () => createUserMessage({ source: { kind: 'plugin', plugin: 'tylina', form: 'instructions' },
      content: [{ type: 'text', text: createTylinaMcpSessionInstructions(instructions, 'memory') }] })
    // Compaction retains the original log while replacing its model-visible surface.
    const retainedCore = () => agent.session.deriveMessages().some(isCore)
    signal.throwIfAborted()
    const execute = withHarnessToolRuntime(call, runtime, store.rootPath, skillsRootPath)
    const pending = new Set<ReturnType<EditorToolCaller>>()
    const invoke: EditorToolCaller = (name, input, callerSignal) => {
      const task = Promise.resolve().then(() => execute(name, input, AbortSignal.any([signal, callerSignal])))
      pending.add(task)
      void task.finally(() => pending.delete(task)).catch(() => undefined)
      return task
    }
    let endpoint: ReturnType<typeof mcp.open> | undefined
    let unregister: (() => void) | undefined
    const owner = agent.ctx.inject(['tools', 'attachments'], (context) => {
      unregister = registerTylinaEditorTools(context, sessionId, invoke)
      context.on('agent/pre-step', async (_payload, next) => {
        const decision = await next()
        if (decision.kind !== 'enter' || retainedCore() || decision.messages.some(isCore)) return decision
        return { ...decision, messages: [coreMessage(), ...decision.messages] }
      })
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
      if (!retainedCore() && !agent.inbox.nextStep.some(isCore)) agent.inject(coreMessage())
      agent.inject(createUserMessage({ source: { kind: 'plugin', plugin: 'tylina', form: 'notice',
        summary: 'Tylina document tools connected' }, content: [{ type: 'text', text:
        `Tylina is connected to this session's document project at ${store.rootPath}. Its file tools use paths relative to that project. ` +
        'Read and change the live document through Tylina tools so unsaved user edits and Undo are retained. ' +
        'Other filesystem tools and scripts use the Harness working directory and their edits arrive as external changes. ' +
        'Do not infer that a disconnected tool completed or retry an uncertain write without inspecting the current document.' }] }))
      endpoint = mcp.open(invoke, createTylinaMcpSessionInstructions(instructions, 'memory'), signal)
      return { dispose, mcp: endpoint.connection }
    } catch (error) { await dispose(); throw error }
  }
}
