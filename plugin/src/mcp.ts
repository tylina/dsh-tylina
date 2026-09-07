import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createMcpHandler, fromJsonSchema, isLegacyRequest, McpServer, type JsonSchemaType } from '@modelcontextprotocol/server'
import { toNodeHandler, toWebRequest } from '@modelcontextprotocol/node'
import { createHarnessCommands } from './commands'
import type { EditorToolCaller } from './tools'
import { createLegacyMcpSessions } from './mcp-legacy'

/** Each endpoint captures one live editor; an old client can never follow a new project implicitly. */
export function createHarnessMcpEndpoints(options: {
  requestRejection(request: IncomingMessage): number | undefined
  version: string
}) {
  const schemas = createHarnessCommands(async () => { throw new Error('An editor is required') }).definitions()
    .map((tool) => ({ ...tool, schema: fromJsonSchema<Record<string, unknown>>(tool.inputSchema as JsonSchemaType) }))
  const endpoints = new Map<string, {
    token: Buffer; fetch: ReturnType<typeof createMcpHandler>['fetch']; close(): Promise<void>; active: Set<AbortController>
    legacy: ReturnType<typeof createLegacyMcpSessions>
  }>()
  let disposed = false
  let requests = 0
  return {
    open(call: EditorToolCaller, instructions: string, lifetime: AbortSignal) {
      const commands = createHarnessCommands(call)
      lifetime.throwIfAborted()
      if (disposed) throw new Error('The Tylina MCP host is closed')
      const connection = { path: `/tylina/mcp/${randomUUID()}`, token: randomBytes(32).toString('base64url') }
      const createServer = (httpSignal?: AbortSignal) => {
        const server = new McpServer({ name: 'tylina', version: options.version }, { instructions })
        for (const tool of schemas) server.registerTool(tool.name, {
          description: tool.description, annotations: tool.annotations, inputSchema: tool.schema
        }, async (input, context) => {
          try {
            const result = await commands.call(tool.name, input, {
              signal: AbortSignal.any([lifetime, context.mcpReq.signal, ...(httpSignal ? [httpSignal] : [])]) })
            return { ...result, structuredContent: result.structuredContent as Record<string, unknown> | undefined }
          } catch (error) {
            return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'The document tool failed' }] }
          }
        })
        return server
      }
      const handler = createMcpHandler((transport) => createServer(transport.requestInfo?.signal), { maxSubscriptions: 0, legacy: 'reject' })
      const legacy = createLegacyMcpSessions(createServer)
      let closing: Promise<void> | undefined
      const close = () => {
        if (closing) return closing
        endpoints.delete(connection.path)
        lifetime.removeEventListener('abort', close)
        for (const abort of endpoint.active) abort.abort(new Error('This Tylina MCP connection expired'))
        closing = Promise.allSettled([handler.close(), legacy.dispose()]).then(() => undefined)
        return closing
      }
      const endpoint = { token: Buffer.from(`Bearer ${connection.token}`), fetch: handler.fetch, close, legacy,
        active: new Set<AbortController>() }
      endpoints.set(connection.path, endpoint)
      lifetime.addEventListener('abort', close, { once: true })
      return { connection, dispose: close }
    },
    async handle(request: IncomingMessage, response: ServerResponse) {
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader('X-Content-Type-Options', 'nosniff')
      const reject = (status: number) => { response.writeHead(status); response.end() }
      // Connection returns 403 for untrusted Host/Origin, then 401 for a missing browser cookie.
      // Machine clients use their editor-scoped bearer instead of exporting the Harness browser credential.
      const rejection = options.requestRejection(request)
      if (rejection !== undefined && rejection !== 401) { reject(403); return }
      const url = new URL(request.url ?? '/', 'http://localhost')
      const endpoint = endpoints.get(url.pathname)
      if (disposed || !endpoint || url.search) { reject(404); return }
      const actual = Buffer.from(request.headers.authorization ?? '')
      if (actual.length !== endpoint.token.length || !timingSafeEqual(actual, endpoint.token)) { reject(401); return }
      if (!['POST', 'GET', 'DELETE'].includes(request.method ?? '')) { response.setHeader('Allow', 'POST, GET, DELETE'); reject(405); return }
      if (request.method === 'POST' && request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') { reject(415); return }
      if (requests >= 64 || endpoint.active.size >= 16) { reject(429); return }
      requests++
      const abort = new AbortController()
      endpoint.active.add(abort)
      const disconnected = () => { if (!response.writableFinished) abort.abort(new Error('The MCP client disconnected')) }
      const cancelled = () => { if (!response.writableFinished) response.destroy(); request.destroy() }
      response.on('close', disconnected)
      abort.signal.addEventListener('abort', cancelled, { once: true })
      const deadline = setTimeout(() => abort.abort(new Error('The MCP request timed out')), 120_000)
      const bodyDeadline = setTimeout(() => abort.abort(new Error('The MCP request body timed out')), 10_000)
      try {
        const chunks: Buffer[] = []
        let bytes = 0
        for await (const chunk of request) {
          bytes += chunk.length
          if (bytes > 2 * 1024 * 1024) { reject(413); return }
          chunks.push(Buffer.from(chunk))
        }
        clearTimeout(bodyDeadline)
        const body: unknown = request.method === 'POST' ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined
        abort.signal.throwIfAborted()
        if (await isLegacyRequest(await toWebRequest(request, body), body)) {
          await endpoint.legacy.handle(request, response, body)
          return
        }
        await toNodeHandler({ fetch: (request, options) => endpoint.fetch(new Request(request, {
          signal: AbortSignal.any([request.signal, abort.signal])
        }), options) })(request, response, body)
      } catch {
        if (!response.headersSent && !response.destroyed) reject(400)
      } finally {
        clearTimeout(deadline); clearTimeout(bodyDeadline)
        response.off('close', disconnected); abort.signal.removeEventListener('abort', cancelled)
        endpoint.active.delete(abort); requests--
      }
    },
    async dispose() {
      disposed = true
      await Promise.allSettled([...endpoints.values()].map((endpoint) => endpoint.close()))
    }
  }
}
