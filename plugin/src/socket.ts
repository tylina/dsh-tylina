import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, WebSocket } from 'ws'
import { createNativeEmbeddingRuntime } from '@tylina/node-runtime/embedding'
import type { RuntimeRequest } from '@tylina/embed/types'
import type { LspProcessOptions } from '@tylina/node-runtime/lsp-transport'

export function createRuntimeSocket(options: {
  authorize(request: IncomingMessage): number | undefined
  sidecar: LspProcessOptions; languageServer: LspProcessOptions
}) {
  const server = new WebSocketServer({ noServer: true, maxPayload: 192 * 1024 * 1024, perMessageDeflate: false })
  let disposed = false
  server.on('connection', (socket) => {
    const runtime = createNativeEmbeddingRuntime(options)
    const pending = new Set<number>()
    let alive = true
    const send = (message: unknown) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
    }
    const unsubscribe = runtime.onNotification((payload) => send({ kind: 'notification', payload }))
    socket.on('pong', () => { alive = true })
    const heartbeat = setInterval(() => {
      if (!alive) { socket.terminate(); return }
      alive = false; socket.ping()
    }, 30_000)
    const close = () => { clearInterval(heartbeat); unsubscribe(); runtime.dispose() }
    socket.on('close', close)
    socket.on('error', () => { close(); socket.terminate() })
    socket.on('message', (data, binary) => {
      let id: number
      let payload: RuntimeRequest
      try {
        if (binary) throw new Error('Text messages required')
        const message = JSON.parse(data.toString())
        id = message.id; payload = message.payload
        if (message.kind !== 'request' || !Number.isSafeInteger(id) || id < 1 || pending.has(id) || pending.size >= 64) {
          throw new Error('Invalid request')
        }
        if (!payload || !['compiler', 'commands', 'language'].includes(payload.channel)) throw new Error('Invalid runtime channel')
        if (payload.channel === 'language' && (!['request', 'notification'].includes(payload.type) || typeof payload.payload?.method !== 'string')) {
          throw new Error('Invalid language request')
        }
        pending.add(id)
      } catch { socket.close(1008, 'Invalid runtime request'); return }
      void runtime.request(payload).then(
        (result) => send({ kind: 'response', id, result }),
        (error: unknown) => send({ kind: 'response', id, error: error instanceof Error ? error.message : String(error) })
      ).catch(() => socket.terminate()).finally(() => pending.delete(id))
    })
  })
  return {
    upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
      if (disposed || options.authorize(request) !== undefined || !request.headers.origin || server.clients.size >= 16) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return
      }
      server.handleUpgrade(request, socket, head, (client) => server.emit('connection', client, request))
    },
    dispose() {
      disposed = true
      for (const socket of server.clients) socket.terminate()
      server.close()
    }
  }
}
