import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isInitializeRequest, type McpServer } from '@modelcontextprotocol/server'
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node'

/** 2025 clients send cancellation on a separate HTTP request, so they require scoped protocol sessions. */
export function createLegacyMcpSessions(createServer: () => McpServer) {
  const sessions = new Map<string, { server: McpServer; transport: NodeStreamableHTTPServerTransport }>()
  let disposed = false
  return {
    async handle(request: IncomingMessage, response: ServerResponse, body: unknown) {
      if (disposed) { response.writeHead(404); response.end(); return }
      const id = request.headers['mcp-session-id']
      let session = typeof id === 'string' ? sessions.get(id) : undefined
      if (id && !session) { response.writeHead(404); response.end(); return }
      if (!session) {
        if (request.method !== 'POST' || !isInitializeRequest(body)) { response.writeHead(400); response.end(); return }
        if (sessions.size >= 8) { response.writeHead(429); response.end(); return }
        const id = randomUUID(), server = createServer()
        const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: () => id })
        session = { server, transport }
        sessions.set(id, session)
        server.server.onclose = () => { sessions.delete(id) }
        try { await server.connect(transport) }
        catch (error) { sessions.delete(id); await server.close(); throw error }
      }
      await session.transport.handleRequest(request, response, body)
    },
    async dispose() {
      disposed = true
      await Promise.allSettled([...sessions.values()].map(({ server }) => server.close()))
      sessions.clear()
    }
  }
}
