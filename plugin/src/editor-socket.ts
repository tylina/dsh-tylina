import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, WebSocket } from 'ws'
import type { ToolResult } from '@tylina/agent-tools/registry'
import type { EditorToolCaller } from './tools'
import type { EditorMcpConnection } from './mcp-wire'

interface EditorBinding { mcp?: EditorMcpConnection; dispose(): void | Promise<void> }

/** One authenticated editor owns one Harness session until its operations and registration have been released. */
export function createEditorSocket(options: {
  authorize(request: IncomingMessage): number | undefined
  bind(sessionId: string, call: EditorToolCaller, signal: AbortSignal, project?: string): Promise<EditorBinding>
}) {
  const server = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024, perMessageDeflate: false })
  const owners = new Map<string, WebSocket>()
  const releases = new Set<Promise<void>>()
  let disposed = false
  server.on('connection', (socket) => {
    const lifetime = new AbortController()
    const pending = new Map<number, { resolve(result: ToolResult): void; reject(error: Error): void }>()
    let sessionId: string | undefined
    let binding: Promise<EditorBinding> | undefined
    let ready = false
    let closed = false
    let releasing = false
    let disposal: Promise<void> | undefined
    let drained: (() => void) | undefined
    let alive = true
    let nextId = 0
    const send = (value: object) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)) }
    const deadline = setTimeout(() => socket.close(1008, 'Editor binding timed out'), 30_000)
    const heartbeat = setInterval(() => {
      if (!alive) { socket.terminate(); return }
      alive = false; socket.ping()
    }, 30_000)
    socket.on('pong', () => { alive = true })
    const disposeBinding = () => {
      if (disposal) return disposal
      disposal = (async () => {
        const owner = await binding?.catch(() => undefined)
        await owner?.dispose()
        if (sessionId && owners.get(sessionId) === socket) owners.delete(sessionId)
      })()
      releases.add(disposal)
      void disposal.finally(() => releases.delete(disposal!)).catch(() => undefined)
      return disposal
    }
    const close = () => {
      if (closed) return
      closed = true
      clearTimeout(deadline); clearInterval(heartbeat)
      lifetime.abort(new Error('The Harness editor connection closed'))
      ready = false
      for (const call of pending.values()) call.reject(new Error('The editor disconnected before confirming this tool. Inspect the document before retrying.'))
      pending.clear()
      drained?.()
      void disposeBinding().catch(() => undefined)
    }
    const release = async () => {
      if (releasing) return
      releasing = true; ready = false; clearTimeout(deadline)
      // WebSocket ordering makes this the barrier after all previously dispatched calls.
      send({ kind: 'releasing' })
      lifetime.abort(new Error('The Harness editor tools are reconnecting'))
      if (pending.size) await new Promise<void>((resolve) => { drained = resolve })
      await disposeBinding()
      if (!closed) { send({ kind: 'released' }); socket.close(1000, 'Editor released') }
    }
    socket.on('close', close)
    socket.on('error', () => { close(); socket.terminate() })
    const call: EditorToolCaller = async (name, input, signal) => {
      signal.throwIfAborted()
      if (!ready || lifetime.signal.aborted) throw new Error('The Tylina editor is not connected')
      if (pending.size >= 16) throw new Error('The Tylina editor already has too many pending calls')
      const id = ++nextId
      const cancel = () => send({ kind: 'cancel', id })
      const result = new Promise<ToolResult>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        try { send({ kind: 'call', id, name, input }) }
        catch (error) { pending.delete(id); reject(error instanceof Error ? error : new Error(String(error))) }
      })
      signal.addEventListener('abort', cancel, { once: true })
      try { const value = await result; signal.throwIfAborted(); return value }
      finally { signal.removeEventListener('abort', cancel) }
    }
    socket.on('message', (data, binary) => {
      try {
        if (binary || closed) throw new Error('Invalid editor message')
        const message = JSON.parse(data.toString())
        if (message.kind === 'release' && sessionId) {
          void release().catch((error) => {
            send({ kind: 'error', message: error instanceof Error ? error.message : 'Could not release the editor' })
            socket.close(1011, 'Editor release failed')
          })
          return
        }
        if (message.kind === 'bind') {
          if (sessionId || typeof message.sessionId !== 'string' || !message.sessionId.length || message.sessionId.length > 256) throw new Error('Invalid Harness session')
          if (owners.has(message.sessionId)) throw new Error('This Harness session already has a Tylina editor open')
          if (message.project !== undefined && (typeof message.project !== 'string' || message.project.length > 2048)) throw new Error('Invalid Harness project')
          sessionId = message.sessionId
          owners.set(sessionId!, socket)
          binding = Promise.resolve().then(() => options.bind(sessionId!, call, lifetime.signal, message.project))
          void binding.then((binding) => {
            if (lifetime.signal.aborted) return
            ready = true; clearTimeout(deadline)
            send({ kind: 'bound', sessionId, mcp: binding.mcp })
          }, (error) => {
            if (releasing || closed) return
            send({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
            socket.close(1008, 'Could not bind the editor')
          }).catch(() => socket.terminate())
          return
        }
        if ((!ready && !releasing) || message.kind !== 'result' || !Number.isSafeInteger(message.id)) throw new Error('Invalid editor tool result')
        const current = pending.get(message.id)
        if (!current) throw new Error('Unexpected editor tool result')
        pending.delete(message.id)
        if (typeof message.error === 'string') current.reject(new Error(message.error.slice(0, 8192)))
        else current.resolve(message.result)
        if (!pending.size) drained?.()
      } catch (error) {
        send({ kind: 'error', message: error instanceof Error ? error.message : 'Invalid editor connection' })
        socket.close(1008, 'Invalid editor connection')
      }
    })
  })
  return {
    upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
      if (disposed || options.authorize(request) !== undefined || !request.headers.origin || server.clients.size >= 16) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return
      }
      server.handleUpgrade(request, socket, head, (client) => server.emit('connection', client, request))
    },
    async dispose() {
      disposed = true
      for (const socket of server.clients) socket.terminate()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await Promise.allSettled([...releases])
    }
  }
}
