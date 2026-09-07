import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { after, test } from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(join(root, 'plugin/package.json'))
const { WebSocket } = require('ws')
const temporary = await mkdtemp(join(root, '.benchmarks/dsh-editor-connection-'))
after(() => rm(temporary, { recursive: true, force: true }))
await require('esbuild').build({ entryPoints: {
  server: join(root, 'plugin/src/editor-socket.ts'),
  client: join(root, 'plugin/src/client/editor-connection.ts')
}, outdir: temporary, bundle: true, platform: 'node', format: 'cjs', outExtension: { '.js': '.cjs' }, target: 'node22' })
const { createEditorSocket } = require(join(temporary, 'server.cjs'))
const { connectHarnessEditor } = await import(pathToFileURL(join(temporary, 'client.cjs')).href)
const originalWebSocket = globalThis.WebSocket
globalThis.WebSocket = class extends WebSocket {
  constructor(url) { super(url, { origin: new URL(url).origin.replace('ws:', 'http:') }) }
}
after(() => { globalThis.WebSocket = originalWebSocket })

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function setup(bind) {
  const http = createServer((_req, res) => { res.writeHead(404); res.end() })
  const runtime = createEditorSocket({ authorize: (req) => req.headers['x-deny'] ? 401 : undefined, bind })
  http.on('upgrade', runtime.upgrade)
  http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  const url = new URL(`ws://127.0.0.1:${http.address().port}/editor`)
  return { url, runtime, async dispose() { await runtime.dispose(); await new Promise((resolve) => http.close(resolve)) } }
}

function client(host, sessionId, callTool = async () => ({ content: [] })) {
  const disconnected = deferred()
  return { disconnected: disconnected.promise, ...connectHarnessEditor({ url: host.url, sessionId,
    editor: { callTool }, onDisconnect: disconnected.resolve }) }
}

test('authenticated editor connections round-trip results and wait for cancelled owned work', async () => {
  let serverCall
  const host = await setup(async (_session, call) => { serverCall = call; return { dispose() {} } })
  const entered = deferred(), settle = deferred()
  let activeSignal
  let calls = 0
  const editor = client(host, 'session-a', async (name, input, { signal }) => {
    calls++; activeSignal = signal
    if (name === 'waiting') { entered.resolve(); await settle.promise }
    return { content: [{ type: 'text', text: name }], structuredContent: input }
  })
  try {
    await editor.ready
    const result = await serverCall('read', { file: 'main.typ' }, new AbortController().signal)
    assert.deepEqual(result, { content: [{ type: 'text', text: 'read' }], structuredContent: { file: 'main.typ' } })
    const abort = new AbortController()
    const pending = serverCall('waiting', {}, abort.signal)
    const rejected = assert.rejects(pending, /cancelled/)
    await entered.promise
    const aborted = once(activeSignal, 'abort')
    abort.abort(new Error('User cancelled'))
    await aborted
    let finished = false
    void pending.finally(() => { finished = true }).catch(() => undefined)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(finished, false, 'abort does not release serialization ahead of editor work')
    settle.resolve()
    await rejected
    await serverCall('read-again', {}, new AbortController().signal)
    assert.equal(calls, 3)
  } finally { editor.dispose(); await host.dispose() }
})

test('session ownership is exclusive through asynchronous disposal, with no tool replay', async () => {
  let serverCall, lifetime
  const release = deferred(), disposing = deferred(), started = deferred(), work = deferred()
  let registrations = 0, calls = 0
  const host = await setup(async (_session, call, signal) => {
    serverCall = call; lifetime = signal; registrations++
    return { async dispose() { disposing.resolve(); await release.promise } }
  })
  const first = client(host, 'same-session', async (_name, _input, { signal }) => {
    calls++; started.resolve(signal); await work.promise; return { content: [] }
  })
  let duplicate, afterClose, next
  try {
    await first.ready
    duplicate = client(host, 'same-session')
    await assert.rejects(duplicate.ready, /already has/)
    assert.equal(registrations, 1)
    const pending = serverCall('write', {}, new AbortController().signal)
    const rejected = assert.rejects(pending, /disconnected before confirming/)
    const callSignal = await started.promise
    first.dispose()
    let localWorkReleased = false
    const localDrain = first.release().then(() => { localWorkReleased = true })
    await disposing.promise
    await rejected
    assert.equal(lifetime.aborted, true)
    assert.equal(callSignal.aborted, true)
    assert.equal(localWorkReleased, false, 'an already closed socket still waits for its local tool to settle')
    afterClose = client(host, 'same-session')
    await assert.rejects(afterClose.ready, /already has/)
    release.resolve()
    work.resolve()
    await localDrain
    await new Promise((resolve) => setImmediate(resolve))
    next = client(host, 'same-session')
    await next.ready
    assert.equal(registrations, 2)
    assert.equal(calls, 1, 'uncertain writes are never retried on a replacement editor')
  } finally {
    release.resolve(); work.resolve()
    first.dispose(); duplicate?.dispose(); afterClose?.dispose(); next?.dispose()
    await host.dispose()
  }
})

test('disconnect during asynchronous binding aborts and disposes the late registration', async () => {
  const entered = deferred(), finish = deferred(), disposed = deferred()
  const host = await setup(async (_session, _call, signal) => {
    entered.resolve(signal); await finish.promise
    return { dispose() { disposed.resolve() } }
  })
  const editor = client(host, 'late-session')
  try {
    const signal = await entered.promise
    const aborted = once(signal, 'abort')
    editor.dispose()
    await assert.rejects(editor.ready, /closed/)
    await aborted
    let complete = false
    const closing = host.runtime.dispose().then(() => { complete = true })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(complete, false)
    finish.resolve()
    await disposed.promise
    await closing
  } finally { finish.resolve(); editor.dispose(); await host.dispose() }
})

test('explicit release waits for cancelled editor work and asynchronous registration cleanup before reconnecting', async () => {
  let serverCall, calls = 0, registrations = 0
  const entered = deferred(), work = deferred(), disposing = deferred(), cleanup = deferred()
  const host = await setup(async (_session, call) => {
    serverCall = call; registrations++
    return { async dispose() { disposing.resolve(); await cleanup.promise } }
  })
  const first = client(host, 'reconnect-session', async (_name, _input, { signal }) => {
    calls++; entered.resolve(signal); await work.promise
    return { content: [{ type: 'text', text: 'Confirmed once' }] }
  })
  let next, duplicate
  try {
    await first.ready
    const result = serverCall('write', {}, new AbortController().signal)
    void result.catch(() => undefined)
    const signal = await entered.promise
    const cancelled = once(signal, 'abort')
    const releasing = first.release()
    assert.equal(first.release(), releasing, 'repeated release shares one handoff')
    let released = false
    void releasing.then(() => { released = true })
    await cancelled
    await assert.rejects(serverCall('new-write', {}, new AbortController().signal), /not connected/)
    assert.equal(released, false)
    duplicate = client(host, 'reconnect-session')
    await assert.rejects(duplicate.ready, /already has/)
    assert.equal(registrations, 1)
    work.resolve()
    assert.equal((await result).content[0].text, 'Confirmed once')
    await disposing.promise
    assert.equal(released, false, 'a settled tool does not skip registration cleanup')
    cleanup.resolve()
    await releasing
    next = client(host, 'reconnect-session')
    await next.ready
    assert.equal(registrations, 2)
    assert.equal(calls, 1, 'reconnection does not replay a completed write')
  } finally {
    work.resolve(); cleanup.resolve(); first.dispose(); duplicate?.dispose(); next?.dispose(); await host.dispose()
  }
})

test('release during binding waits for the late owner and leaves no orphaned registration', async () => {
  const entered = deferred(), finish = deferred(), disposed = deferred()
  const host = await setup(async (_session, _call, signal) => {
    entered.resolve(signal); await finish.promise
    return { dispose() { disposed.resolve() } }
  })
  const editor = client(host, 'release-during-bind')
  try {
    const signal = await entered.promise
    const aborted = once(signal, 'abort')
    const releasing = editor.release()
    let released = false
    void releasing.then(() => { released = true })
    await aborted
    assert.equal(released, false)
    finish.resolve()
    await disposed.promise
    await releasing
    await assert.rejects(editor.ready, /released/)
  } finally { finish.resolve(); editor.dispose(); await host.dispose() }
})

test('failed cleanup never acknowledges release or transfers its session to a new owner', async () => {
  const host = await setup(async () => ({ dispose() { throw new Error('Fixture registration cleanup failed') } }))
  const first = client(host, 'cleanup-failed')
  let second
  try {
    await first.ready
    await assert.rejects(first.release(), /cleanup failed/)
    second = client(host, 'cleanup-failed')
    await assert.rejects(second.ready, /already has/)
  } finally { first.dispose(); second?.dispose(); await host.dispose() }
})

test('upgrade enforces the host authorization and browser Origin boundary', async () => {
  let registrations = 0
  const host = await setup(async () => { registrations++; return { dispose() {} } })
  try {
    for (const options of [{}, { origin: 'http://127.0.0.1', headers: { 'x-deny': 'yes' } }]) {
      const socket = new WebSocket(host.url, options)
      await assert.rejects(once(socket, 'open'), /403/)
      socket.terminate()
    }
    assert.equal(registrations, 0)
  } finally { await host.dispose() }
})

test('MCP configuration belongs to the current binding and rejects normalized foreign paths', async () => {
  for (const path of ['/tylina/mcp/bound', '/tylina/mcp/../api']) {
    const host = await setup(async () => ({ mcp: { path, token: 'fixture-capability'.repeat(3) }, dispose() {} }))
    const editor = client(host, 'mcp-owner')
    try {
      if (path.endsWith('/api')) await assert.rejects(editor.ready, /Invalid MCP address/)
      else {
        await editor.ready
        assert.equal(editor.mcpConfiguration().mcpServers.tylina.url, new URL(path, host.url).href.replace('ws:', 'http:'))
        editor.dispose()
        assert.throws(() => editor.mcpConfiguration(), /Reconnect/)
      }
    } finally { editor.dispose(); await host.dispose() }
  }
})
