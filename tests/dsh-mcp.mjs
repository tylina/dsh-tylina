import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { commandInput } from './command-input.mjs'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer, request as httpRequest } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(join(root, 'plugin/package.json'))
const desktop = createRequire(join(root, 'package.json'))
const { Client, StreamableHTTPClientTransport } = desktop('@modelcontextprotocol/client')
await mkdir(join(root, '.benchmarks'), { recursive: true })
const temporary = await mkdtemp(join(root, '.benchmarks/dsh-mcp-'))
after(() => rm(temporary, { recursive: true, force: true }))
await require('esbuild').build({ entryPoints: [join(root, 'plugin/src/mcp.ts')],
  outfile: join(temporary, 'server.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22' })
const { createHarnessMcpEndpoints } = require(join(temporary, 'server.cjs'))

function deferred() { let resolve; const promise = new Promise((yes) => { resolve = yes }); return { promise, resolve } }
async function setup() {
  const host = createHarnessMcpEndpoints({ version: 'test', requestRejection: (request) =>
    request.headers.origin === 'https://untrusted.invalid' || request.headers.host === 'untrusted.invalid' ? 403 : 401 })
  const http = createServer((request, response) => { void host.handle(request, response) })
  http.listen(0, '127.0.0.1'); await once(http, 'listening')
  const origin = `http://127.0.0.1:${http.address().port}`
  return { host, origin, async dispose() { await host.dispose(); http.closeAllConnections(); await new Promise((resolve) => http.close(resolve)) } }
}
async function connect(origin, connection, mode) {
  const client = new Client({ name: 'tylina-mcp-acceptance', version: 'test' }, { versionNegotiation: { mode } })
  await client.connect(new StreamableHTTPClientTransport(new URL(connection.path, origin), {
    requestInit: { headers: { Authorization: `Bearer ${connection.token}` } }
  }))
  const originalCall = client.callTool.bind(client)
  client.callTool = ({ name, arguments: args }, ...rest) => originalCall(commandInput(name, args), ...rest)
  return client
}

for (const mode of ['legacy', 'auto']) {
test(`${mode}: real HTTP MCP discovers the shared tools, instructions and images without Harness cookies`, async () => {
  const env = await setup()
  const calls = []
  const bound = env.host.open(async (name, input) => {
    calls.push({ name, input })
    return { content: [{ type: 'text', text: 'real transport fixture' }, { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }],
      structuredContent: { project: 'bound-project' } }
  }, 'Shared Typst authoring instructions', new AbortController().signal)
  let client
  try {
    const address = new URL(bound.connection.path, env.origin)
    const headers = { Authorization: `Bearer ${bound.connection.token}`, 'Content-Type': 'application/json' }
    assert.equal((await fetch(address, { method: 'POST' })).status, 401)
    assert.equal((await fetch(address, { method: 'POST', headers: { ...headers, Origin: 'https://untrusted.invalid' } })).status, 403)
    assert.equal(await new Promise((resolve, reject) => {
      const request = httpRequest(address, { method: 'POST', headers: { ...headers, Host: 'untrusted.invalid' } },
        (response) => { response.resume(); resolve(response.statusCode) })
      request.on('error', reject); request.end()
    }), 403)
    assert.equal((await fetch(address, { method: 'POST', headers, body: '{' })).status, 400)
    client = await connect(env.origin, bound.connection, mode)
    assert.match(client.getInstructions(), /Shared Typst/)
    const { tools } = await client.listTools()
    assert.equal(tools.length, 1)
    assert.equal(tools[0].name, 'tylina')
    const help = await client.callTool({ name: 'tylina', arguments: { command: 'help', args: { command: 'file.write' } } })
    assert.ok(help.structuredContent.inputSchema.required.includes('expectedSha256'))
    const result = await client.callTool({ name: 'tylina_render_page', arguments: { page: 1 } })
    assert.equal(result.structuredContent.project, 'bound-project')
    assert.equal(result.content[1].mimeType, 'image/png')
    assert.equal(calls.length, 1)
    const invalid = await client.callTool({ name: 'tylina_write_file', arguments: { file: 'main.typ' } })
    assert.equal(invalid.isError, true)
    assert.equal(calls.length, 1, 'invalid mutations are rejected before reaching the editor')
    await assert.rejects(client.callTool({ name: 'not-a-tylina-tool', arguments: {} }), /not found/)
    assert.equal(calls.length, 1)
    await bound.dispose()
    assert.equal((await fetch(address, { method: 'POST', headers })).status, 404)
    const next = env.host.open(async () => { throw new Error('Old clients cannot reach this project') }, '', new AbortController().signal)
    assert.notEqual(next.connection.path, bound.connection.path)
    assert.notEqual(next.connection.token, bound.connection.token)
    assert.equal((await fetch(new URL(next.connection.path, env.origin), { method: 'POST', headers })).status, 401)
    await next.dispose()
  } finally { await client?.close(); await bound.dispose(); await env.dispose() }
})

test(`${mode}: HTTP cancellation and editor expiry reach actual pending work without replay`, async () => {
  const env = await setup()
  const lifetime = new AbortController(), entered = deferred(), work = deferred()
  let count = 0
  const bound = env.host.open(async (_name, _input, signal) => {
    count++; entered.resolve(signal); await work.promise; signal.throwIfAborted(); return { content: [] }
  }, '', lifetime.signal)
  let client
  try {
    client = await connect(env.origin, bound.connection, mode)
    const abort = new AbortController()
    const pending = client.callTool({ name: 'tylina_write_file', arguments: {
      file: 'main.typ', contents: 'test', expectedSha256: null
    } }, { signal: abort.signal })
    const rejected = assert.rejects(pending)
    const signal = await entered.promise
    const stopped = once(signal, 'abort')
    abort.abort(new Error('User cancelled'))
    await rejected; await stopped
    assert.equal(signal.aborted, true)
    lifetime.abort()
    assert.equal((await fetch(new URL(bound.connection.path, env.origin))).status, 404)
    work.resolve()
    assert.equal(count, 1)
  } finally { work.resolve(); await client?.close(); await bound.dispose(); await env.dispose() }
})
}


test('SDK CLI uses the same authenticated command protocol and preserves failure exit status',
  { skip: !process.env.TYLINA_SDK_CLI }, async () => {
    const env = await setup()
    const calls = []
    const bound = env.host.open(async (name, input) => {
      calls.push({ name, input })
      return { structuredContent: { received: input }, content: [{ type: 'text', text: JSON.stringify(input) }] }
    }, '', new AbortController().signal)
    const run = promisify(execFile)
    const options = { env: { ...process.env, TYLINA_MCP_URL: new URL(bound.connection.path, env.origin).href,
      TYLINA_MCP_TOKEN: bound.connection.token }, timeout: 20_000 }
    try {
      const help = await run(process.execPath, [process.env.TYLINA_SDK_CLI, 'help'], options)
      assert.ok(JSON.parse(help.stdout).structuredContent.commands.some((item) => item.command === 'editor.state'))
      const read = await run(process.execPath, [process.env.TYLINA_SDK_CLI, 'file.read', '--args', JSON.stringify({ file: 'notes.typ' })], options)
      assert.equal(JSON.parse(read.stdout).structuredContent.received.file, 'notes.typ')
      assert.equal(calls.at(-1).name, 'tylina_read_file')
      await assert.rejects(run(process.execPath, [process.env.TYLINA_SDK_CLI, 'file.edit', '--args', '{}'], options), (error) => error.code === 1)
      assert.equal(calls.length, 1, 'invalid CLI writes never reach the editor')
    } finally { await bound.dispose(); await env.dispose() }
  })
