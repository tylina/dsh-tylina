import type { TylinaEditor } from '@tylina/embed'
import type { EditorMcpConnection } from '../mcp-wire'

/** Hiding the document retains this connection; only its owner may dispose or bind another session. */
export function connectHarnessEditor(options: {
  url: URL; sessionId: string; project?: string; editor: Pick<TylinaEditor, 'callTool'>; onDisconnect(error: Error): void
}) {
  const socket = new WebSocket(options.url)
  const pending = new Map<number, { controller: AbortController; task: Promise<void> }>()
  let closed = false
  let bound = false
  let quiescing = false
  let releasing: Promise<void> | undefined
  let resolveRelease: (() => void) | undefined
  let rejectRelease: ((error: Error) => void) | undefined
  let releaseTimer: ReturnType<typeof setTimeout> | undefined
  let mcp: EditorMcpConnection | undefined
  let resolveReady!: () => void
  let rejectReady!: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  void ready.catch(() => undefined)
  const timer = setTimeout(() => stop(new Error('The Harness editor connection timed out')), 30_000)
  const send = (value: object) => { if (!closed && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)) }
  function stop(error: Error, report = true) {
    if (closed) return
    closed = true
    mcp = undefined
    clearTimeout(timer)
    clearTimeout(releaseTimer)
    rejectReady(error)
    rejectRelease?.(error)
    for (const { controller } of pending.values()) controller.abort(error)
    socket.close()
    if (report) options.onDisconnect(error)
  }
  socket.onopen = () => {
    send({ kind: 'bind', sessionId: options.sessionId, project: options.project })
    if (releasing) send({ kind: 'release' })
  }
  socket.onclose = () => stop(new Error('The Harness editor connection closed. Reconnect before running document tools.'))
  socket.onerror = () => stop(new Error('Could not connect this editor to Harness'))
  socket.onmessage = ({ data }) => {
    try {
      if (closed) return
      if (typeof data !== 'string' || data.length > 4 * 1024 * 1024) throw new Error('Invalid Harness editor message')
      const message = JSON.parse(data)
      if (message.kind === 'error' && typeof message.message === 'string') { stop(new Error(message.message)); return }
      if (message.kind === 'releasing' && releasing && !quiescing) {
        quiescing = true; mcp = undefined; clearTimeout(timer)
        for (const { controller } of pending.values()) controller.abort(new Error('The Harness editor tools are reconnecting'))
        return
      }
      if (message.kind === 'released' && quiescing && pending.size === 0) {
        resolveRelease?.(); stop(new Error('The Harness editor tools were released'), false); return
      }
      if (message.kind === 'bound' && message.sessionId === options.sessionId && !bound) {
        if (message.mcp !== undefined) {
          if (typeof message.mcp.path !== 'string' || !message.mcp.path.startsWith('/tylina/mcp/') ||
            typeof message.mcp.token !== 'string' || message.mcp.token.length < 32 || message.mcp.token.length > 256) {
            throw new Error('Invalid MCP connection')
          }
          const address = new URL(message.mcp.path, options.url)
          if (address.origin !== options.url.origin || address.pathname !== message.mcp.path || address.search || address.hash) throw new Error('Invalid MCP address')
          mcp = { path: address.pathname, token: message.mcp.token }
        }
        bound = true; clearTimeout(timer); resolveReady(); return
      }
      if (!bound || !Number.isSafeInteger(message.id) || message.id < 1) throw new Error('Invalid Harness editor call')
      if (message.kind === 'cancel') { pending.get(message.id)?.controller.abort(new Error('The Harness tool was cancelled')); return }
      if (quiescing || message.kind !== 'call' || typeof message.name !== 'string' || message.name.length > 128 || pending.has(message.id) || pending.size >= 16) {
        throw new Error('Invalid Harness editor call')
      }
      const controller = new AbortController()
      const task = Promise.resolve().then(() => options.editor.callTool(message.name, message.input, { signal: controller.signal })).then(
        (result) => send({ kind: 'result', id: message.id, result }),
        (error) => send({ kind: 'result', id: message.id, error: error instanceof Error ? error.message : String(error) })
      ).catch((error) => stop(error instanceof Error ? error : new Error(String(error))))
        .finally(() => pending.delete(message.id))
      pending.set(message.id, { controller, task })
    } catch (error) { stop(error instanceof Error ? error : new Error(String(error))) }
  }
  return { ready,
    release(): Promise<void> {
      if (closed) return Promise.allSettled([...pending.values()].map(({ task }) => task)).then(() => undefined)
      if (releasing) return releasing
      mcp = undefined; clearTimeout(timer)
      releasing = new Promise<void>((resolve, reject) => { resolveRelease = resolve; rejectRelease = reject })
      void releasing.catch(() => undefined)
      releaseTimer = setTimeout(() => stop(new Error('The previous tool connection has not confirmed release. Inspect the document before reconnecting again.')), 120_000)
      send({ kind: 'release' })
      return releasing
    },
    mcpConfiguration() {
      if (closed || releasing || !bound || !mcp) throw new Error('Reconnect Agent tools before copying this document’s MCP connection.')
      const url = new URL(mcp.path, options.url)
      url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
      return { mcpServers: { tylina: { type: 'http' as const, url: url.href, headers: { Authorization: `Bearer ${mcp.token}` } } } }
    },
    dispose() { stop(new Error('The Harness editor was closed'), false) } }
}
