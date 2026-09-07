import { commandInput } from './command-input.mjs'
/** Installed only by dsh-bundles.mjs in its isolated, loopback acceptance profile. */
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { createModelFixture } from './dsh-model-fixture.mjs'
export const inject = ['webServer', 'connection', 'sessionController', 'workspaceController', 'sessions', 'tools', 'llm']
export function apply(ctx) {
  let sequence = 0
  const model = createModelFixture(ctx)
  const seed = async (sessionId, title) => {
    model.begin(sessionId, 'Initialize document conversation', { seed: true })
    await ctx.sessionController.selectModel({ sessionId, provider: 'tylina-acceptance', model: 'document-fixture' })
    await ctx.sessionController.prompt({ requestId: `tylina-seed-${++sequence}`, sessionId, mode: 'queue',
      content: [{ type: 'text', text: 'Prepare this document conversation.' }] }, new AbortController().signal)
    const owner = await ctx.sessionController.resolveAgent(sessionId)
    if ('error' in owner) throw new Error(owner.error.message)
    await owner.agent.whenIdle()
    if (!model.read(sessionId)?.complete) throw new Error('The initial model turn did not finish')
    await ctx.sessionController.rename({ sessionId, title })
    await ctx.sessions.flush(owner.agent.session)
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/tylina-acceptance', async handler(request, response) {
    const rejection = ctx.connection.requestRejection(request)
    if (rejection !== undefined) { response.writeHead(rejection); response.end(); return }
    try {
      if (request.method !== 'POST' || !request.headers.origin) throw new Error('Browser POST required')
      let raw = ''
      for await (const chunk of request) { raw += chunk; if (raw.length > 1024 * 1024) throw new Error('Request too large') }
      const input = JSON.parse(raw)
      if (input.action === 'bootstrap') {
        const { workspace } = await ctx.workspaceController.create({ path: process.cwd() })
        const created = await ctx.sessionController.create({ workspaceId: workspace.workspaceId })
        await seed(created.sessionId, 'Conversation A')
        response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(created)); return
      }
      const result = await ctx.sessionController.resolveAgent(input.sessionId)
      if ('error' in result) throw new Error(result.error.message)
      const { agent } = result
      if (input.action === 'create-session') {
        await ctx.sessionController.rename({ sessionId: input.sessionId, title: 'Conversation A' })
        const created = await ctx.sessionController.create({ cwd: input.cwd })
        await seed(created.sessionId, 'Conversation B')
        response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(created)); return
      }
      if (input.action === 'turn') {
        model.begin(input.sessionId, input.marker)
        await ctx.sessionController.selectModel({ sessionId: input.sessionId, provider: 'tylina-acceptance', model: 'document-fixture' })
        await ctx.sessionController.prompt({ requestId: `tylina-turn-${++sequence}`, sessionId: input.sessionId,
          mode: 'queue', content: [{ type: 'text', text: `Append ${input.marker} to this document, then validate and export it.` }] }, new AbortController().signal)
      }
      if (input.action === 'compact') {
        if (agent.status !== 'idle') throw new Error('Only a settled test conversation may be compacted')
        const nodes = [...agent.session.surface.nodes]
        agent.session.append('user/message', createUserMessage({ source: { kind: 'plugin', plugin: 'tylina-acceptance', form: 'recall' },
          content: [{ type: 'text', text: 'The prior document task completed; continue using the current document.' }] }),
        { surfaceOp: { op: 'replace', start: nodes[0], end: nodes.at(-1) }, sourceEventSeqs: nodes })
      }
      const tylinaContext = (message) => message.source.kind === 'plugin' && message.source.plugin === 'tylina'
      const value = ['turn', 'model', 'compact'].includes(input.action) ? { ...model.read(input.sessionId), status: agent.status }
        : input.action === 'catalog' ? ctx.tools.schemas(agent) : input.action === 'instructions'
        ? { pending: agent.inbox.nextStep.filter(tylinaContext), recorded: agent.session.snapshotEvents()
          .filter((event) => event.type === 'user/message' && tylinaContext(event.data)).map((event) => event.data), status: agent.status }
        : await ctx.tools.execute({ agent, ...commandInput(input.name, input.input ?? {}), signal: new AbortController().signal,
          callId: `tylina-acceptance-${++sequence}` })
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value))
    } catch (error) { response.writeHead(400, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: error.message })) }
  } }))
}
