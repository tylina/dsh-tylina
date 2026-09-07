import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, WebSocket } from 'ws'
import { createNativeEmbeddingRuntime } from 'tylina-sdk/node'
import type { RuntimeRequest } from 'tylina-sdk/client'
import type { LspProcessOptions } from 'tylina-sdk/node'

export function createRuntimeSocket(options: {
  authorize(request: IncomingMessage): number | undefined
  sidecar: LspProcessOptions; languageServer: LspProcessOptions
}) {
  const server = new WebSocketServer({ noServer: true, maxPayload: 192 * 1024 * 1024, perMessageDeflate: false })
  let disposed = false
  server.on('connection', (socket) => {
    const runtime = createNativeEmbeddingRuntime(options)
    const pending = new Map<number, AbortController>()
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
    const close = () => {
      clearInterval(heartbeat); unsubscribe()
      for (const controller of pending.values()) controller.abort(new Error('The runtime connection closed'))
      pending.clear(); runtime.dispose()
    }
    socket.on('close', close)
    socket.on('error', () => { close(); socket.terminate() })
    socket.on('message', (data, binary) => {
      let id: number
      let payload: RuntimeRequest
      try {
        if (binary) throw new Error('Text messages required')
        const message = JSON.parse(data.toString())
        id = message.id; payload = message.payload
        if (message.kind === 'cancel' && Number.isSafeInteger(id) && id > 0) {
          pending.get(id)?.abort(new DOMException('The runtime request was cancelled', 'AbortError'))
          return
        }
        if (message.kind !== 'request' || !Number.isSafeInteger(id) || id < 1 || pending.has(id) || pending.size >= 64) {
          throw new Error('Invalid request')
        }
        if (!payload || !['compiler', 'commands', 'language'].includes(payload.channel)) throw new Error('Invalid runtime channel')
        if (payload.channel === 'language' && (!['request', 'notification'].includes(payload.type) || typeof payload.payload?.method !== 'string')) {
          throw new Error('Invalid language request')
        }
        pending.set(id, new AbortController())
      } catch { socket.close(1008, 'Invalid runtime request'); return }
      const signal = pending.get(id)!.signal
      void runtime.request(payload, signal).then((result) => {
        signal.throwIfAborted()
        return result
      }).then(
        (result) => send({ kind: 'response', id, result }),
        (error: unknown) => send({ kind: 'response', id, error: error instanceof Error ? error.message : String(error),
          cancelled: signal.aborted || (error instanceof Error && error.name === 'AbortError') })
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
