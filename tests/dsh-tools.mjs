import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { after, test } from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(join(root, 'plugin/package.json'))
const toolsRequire = createRequire(require.resolve('@deepseek-ai/dsh-tools'))
const load = (name) => import(pathToFileURL(toolsRequire.resolve(name)).href)
const { Context, Service } = await load('@deepseek-ai/cordis')
const { SystemPrompt } = await load('@deepseek-ai/dsh-system-prompt')
const { ToolRuntime } = await load('@deepseek-ai/dsh-tools')
const { createScope } = await load('@deepseek-ai/dsh-scope')
const { ToolCallId } = await load('@deepseek-ai/dsh-llm')
const temporary = await mkdtemp(join(root, '.benchmarks/dsh-tools-'))
after(() => rm(temporary, { recursive: true, force: true }))
await require('esbuild').build({ entryPoints: [join(root, 'plugin/src/tools.ts')],
  outfile: join(temporary, 'tools.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22' })
const { registerTylinaEditorTools } = await import(pathToFileURL(join(temporary, 'tools.mjs')).href)

class AttachmentOwner extends Service {
  batches = []
  constructor(ctx) { super(ctx, 'attachments') }
  async saveImages(inputs) {
    this.batches.push(inputs)
    return inputs.map((input, index) => ({ attachmentId: `stored-image-${index}`, mediaType: input.mediaType,
      bytes: input.data.length, width: 1, height: 1 }))
  }
}

async function setup() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AttachmentOwner)
  let callId = 0
  const run = (agent, name, input = {}, signal = new AbortController().signal) => ctx.tools.execute({
    agent, name, arguments: input, signal, callId: ToolCallId(`tylina-test-${++callId}`)
  })
  return { ctx, run }
}

test('released Harness scopes share the complete catalog and keep each tool bound to its calling editor', async () => {
  const { ctx, run } = await setup()
  const alpha = { id: 'alpha' }, beta = { id: 'beta' }
  const calls = []
  let releaseAlpha, releaseBeta
  const owner = ctx.plugin({ inject: ['tools', 'attachments'], apply(ctx) {
    const a = createScope(ctx, alpha), b = createScope(ctx, beta)
    releaseAlpha = registerTylinaEditorTools(a.ctx, alpha.id, async (name, input) => {
      calls.push({ owner: 'alpha', name, input })
      return { structuredContent: { owner: 'alpha' }, content: [{ type: 'text', text: 'Alpha document' }] }
    })
    releaseBeta = registerTylinaEditorTools(b.ctx, beta.id, async (name, input) => {
      calls.push({ owner: 'beta', name, input })
      return { structuredContent: { owner: 'beta' }, content: [{ type: 'text', text: 'Beta document' }] }
    })
  } })
  await owner
  try {
    assert.equal(ctx.tools.schemas(alpha).length, 18)
    assert.equal(ctx.tools.schemas().length, 0)
    const first = await run(alpha, 'tylina_read_file', { file: 'main.typ' })
    const second = await run(beta, 'tylina_validate_document')
    assert.equal(first.isError, false)
    assert.equal(second.isError, false)
    assert.equal(first.value.structuredContent.owner, 'alpha')
    assert.equal(second.value.structuredContent.owner, 'beta')
    assert.deepEqual(calls.map((call) => call.owner), ['alpha', 'beta'])
    assert.equal((await run({ id: 'alpha' }, 'tylina_write_file')).isError, true, 'an unrelated Agent with a copied string id has no registered tool scope')
    releaseAlpha()
    assert.equal(ctx.tools.schemas(alpha).length, 0)
    assert.equal((await run(alpha, 'tylina_read_file')).isError, true)
    assert.equal((await run(beta, 'tylina_read_file')).isError, false)
    releaseBeta()
  } finally { await ctx.fiber.dispose() }
})

test('Harness owns image persistence, tool failures, cancellation and disposable registration', async () => {
  const { ctx, run } = await setup()
  const agent = { id: 'image-session' }
  let response = { content: [{ type: 'image', mimeType: 'image/png', data: Buffer.from([1, 2, 3]).toString('base64') }],
    structuredContent: { page: 1 } }
  let pending
  let activeSignal
  const owner = ctx.plugin({ inject: ['tools', 'attachments'], apply(ctx) {
    const scope = createScope(ctx, agent)
    registerTylinaEditorTools(scope.ctx, agent.id, async (_name, _input, signal) => {
      activeSignal = signal
      if (pending) await pending
      return response
    })
  } })
  await owner
  try {
    const rendered = await run(agent, 'tylina_render_page', { page: 1 })
    assert.equal(rendered.isError, false)
    assert.deepEqual(rendered.content, [{ type: 'image', attachment: { attachmentId: 'stored-image-0', mediaType: 'image/png', bytes: 3, width: 1, height: 1 } }])
    assert.equal(ctx.attachments.batches.length, 1)
    assert.ok(!JSON.stringify(rendered.value).includes('AQID'), 'raw base64 never enters the durable tool value')
    response = { isError: true, content: [{ type: 'text', text: 'Document service failed' }] }
    const failed = await run(agent, 'tylina_validate_document')
    assert.equal(failed.isError, true)
    assert.ok(JSON.stringify(failed).includes('Document service failed'))
    response = { content: [{ type: 'text', text: 'Settled' }] }
    let release
    pending = new Promise((resolve) => { release = resolve })
    const abort = new AbortController()
    let settled = false
    const cancelled = run(agent, 'tylina_write_file', {}, abort.signal).finally(() => { settled = true })
    await new Promise((resolve) => setImmediate(resolve))
    abort.abort(new Error('User cancelled'))
    assert.equal(activeSignal.aborted, true)
    assert.equal(settled, false, 'cancellation must wait for owned work')
    release()
    assert.equal((await cancelled).isError, true)
    await owner.dispose()
    assert.equal(ctx.tools.schemas(agent).length, 0)
  } finally { await ctx.fiber.dispose() }
})
