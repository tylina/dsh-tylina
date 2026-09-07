import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { after, test } from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(join(root, 'plugin/package.json'))
const { WebSocket } = require('ws')
const sdk = require.resolve('tylina-sdk/package.json')
const { createWebSocketRuntime } = await import(pathToFileURL(join(dirname(sdk), require(sdk).exports['./client'].import)).href)
const binary = process.env.TYLINA_TEST_SIDECAR
assert.ok(binary, 'Set TYLINA_TEST_SIDECAR to a release tylina-tinymist executable')
await mkdir(join(root, '.benchmarks'), { recursive: true })
const temporary = await mkdtemp(join(root, '.benchmarks/dsh-runtime-cancel-'))
after(() => rm(temporary, { recursive: true, force: true }))
await require('esbuild').build({ entryPoints: [join(root, 'plugin/src/socket.ts')], outfile: join(temporary, 'server.cjs'),
  bundle: true, platform: 'node', format: 'cjs', target: 'node22' })
const { createRuntimeSocket } = require(join(temporary, 'server.cjs'))
const originalWebSocket = globalThis.WebSocket
const messages = []
globalThis.WebSocket = class extends WebSocket {
  constructor(url) { super(url, { origin: new URL(url).origin.replace('ws:', 'http:') }) }
  send(data) { messages.push(JSON.parse(data)); return super.send(data) }
}
after(() => { globalThis.WebSocket = originalWebSocket })

async function setup() {
  const http = createServer((_req, res) => { res.writeHead(404); res.end() })
  const runtime = createRuntimeSocket({ authorize: () => undefined,
    sidecar: { command: binary, args: ['--serve'] }, languageServer: { command: binary, args: [] } })
  http.on('upgrade', runtime.upgrade)
  http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  const errors = []
  const client = createWebSocketRuntime(`ws://127.0.0.1:${http.address().port}/runtime`, (error) => errors.push(error))
  return { client, errors, async dispose() { client.dispose(); runtime.dispose(); await new Promise((resolve) => http.close(resolve)) } }
}
function query(contents = '= Recovered', channel = 'commands') {
  return { channel, payload: { workspace: { rootPath: '/project', mainFilePath: '/project/main.typ',
    sourceRevision: 0, allowWorkspaceDisk: false, files: [{ path: '/project/main.typ', contents }], resources: [] },
    query: { kind: 'validateWorkspace' } } }
}

test('real native runtime cancellation crosses the SDK socket and leaves preview and later commands usable', { timeout: 15000 }, async () => {
  const host = await setup()
  const controller = new AbortController()
  const watchdog = setTimeout(() => host.client.dispose(), 10000)
  try {
    const pending = host.client.request(query('#lorem(100000)'), controller.signal)
    const sibling = host.client.request(query('= Same engine'))
    const preview = host.client.request(query('= Preview', 'compiler'))
    const outcomes = Promise.allSettled([pending, sibling])
    const cancel = setTimeout(() => controller.abort(), 100)
    try {
      for (const result of await outcomes) {
        assert.equal(result.status, 'rejected')
        assert.equal(result.reason.name, 'AbortError', 'all queries in the stopped engine preserve cancellation type')
      }
      assert.equal((await preview).workspaceValidation.valid, true, 'the separate preview engine continues')
    }
    finally { clearTimeout(cancel) }
    assert.ok(messages.some((message) => message.kind === 'cancel'), 'the request must reach the runtime cancellation protocol')
    const [commands, nextPreview] = await Promise.all([host.client.request(query()), host.client.request(query('= Preview', 'compiler'))])
    assert.equal(commands.workspaceValidation.valid, true)
    assert.equal(nextPreview.workspaceValidation.valid, true)
    assert.deepEqual(host.errors, [], 'request cancellation must not report a lost runtime connection')
  } finally { clearTimeout(watchdog); await host.dispose() }
})

test('pre-cancelled and completed signals cannot stop another runtime request', { timeout: 10000 }, async () => {
  const host = await setup()
  const controller = new AbortController()
  try {
    assert.equal((await host.client.request(query(), controller.signal)).workspaceValidation.valid, true)
    const count = messages.length
    controller.abort()
    await assert.rejects(host.client.request(query(), controller.signal), { name: 'AbortError' })
    assert.equal(messages.length, count, 'neither a completed cancel nor a pre-cancelled request may be sent')
    assert.equal((await host.client.request(query())).workspaceValidation.valid, true)
    assert.deepEqual(host.errors, [])
  } finally { await host.dispose() }
})

test('disposing a runtime connection settles its outstanding native work', { timeout: 10000 }, async () => {
  const host = await setup()
  try {
    const pending = host.client.request(query('#lorem(100000)'))
    const cancel = setTimeout(() => host.client.dispose(), 100)
    try { await assert.rejects(pending, /disposed/) }
    finally { clearTimeout(cancel) }
    assert.deepEqual(host.errors, [])
  } finally { await host.dispose() }
})
