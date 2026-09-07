/** Installed only by dsh-bundles.mjs in its isolated, loopback acceptance profile. */
import { createUserMessage } from '@deepseek-ai/dsh-llm/message'
import { createModelFixture } from './dsh-model-fixture.mjs'
export const inject = ['webServer', 'connection', 'sessionController', 'tools', 'llm']
export function apply(ctx) {
  let sequence = 0
  const model = createModelFixture(ctx)
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/tylina-acceptance', async handler(request, response) {
    const rejection = ctx.connection.requestRejection(request)
    if (rejection !== undefined) { response.writeHead(rejection); response.end(); return }
    try {
      if (request.method !== 'POST' || !request.headers.origin) throw new Error('Browser POST required')
      let raw = ''
      for await (const chunk of request) { raw += chunk; if (raw.length > 1024 * 1024) throw new Error('Request too large') }
      const input = JSON.parse(raw)
      const result = await ctx.sessionController.resolveAgent(input.sessionId)
      if ('error' in result) throw new Error(result.error.message)
      const { agent } = result
      if (input.action === 'create-session') {
        await ctx.sessionController.rename({ sessionId: input.sessionId, title: 'Conversation A' })
        const created = await ctx.sessionController.create({ cwd: input.cwd })
        await ctx.sessionController.rename({ sessionId: created.sessionId, title: 'Conversation B' })
        const other = await ctx.sessionController.resolveAgent(created.sessionId)
        if ('error' in other) throw new Error(other.error.message)
        // Seed settled history through the real Session log; Harness hides non-current blank rows.
        for (const session of [agent.session, other.agent.session]) {
          session.append('turn/start', { turn: 1 })
          session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        }
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
        : await ctx.tools.execute({ agent, name: input.name, arguments: input.input ?? {}, signal: new AbortController().signal,
          callId: `tylina-acceptance-${++sequence}` })
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value))
    } catch (error) { response.writeHead(400, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: error.message })) }
  } }))
}
