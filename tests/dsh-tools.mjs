import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { after, test } from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(join(root, 'plugin/package.json'))
const toolsRequire = createRequire(process.env.TYLINA_DSH_PACKAGE_JSON ?? require.resolve('@deepseek-ai/dsh-tools'))
const load = (name) => import(pathToFileURL(toolsRequire.resolve(name)).href)
const { Context, Service } = await load('@deepseek-ai/cordis')
const { SystemPrompt } = await load('@deepseek-ai/dsh-system-prompt')
const { ToolRuntime } = await load('@deepseek-ai/dsh-tools')
const { createScope } = await load('@deepseek-ai/dsh-scope')
const { ToolCallId } = await load('@deepseek-ai/dsh-llm')
const hostVersion = JSON.parse(await readFile(toolsRequire.resolve('@deepseek-ai/dsh-tools/package.json'), 'utf8')).version
await mkdir(join(root, '.benchmarks'), { recursive: true })
const temporary = await mkdtemp(join(root, '.benchmarks/dsh-tools-'))
after(() => rm(temporary, { recursive: true, force: true }))
await require('esbuild').build({ entryPoints: [join(root, 'plugin/src/tools.ts')],
  outfile: join(temporary, 'tools.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22' })
const { registerTylinaEditorTools } = await import(pathToFileURL(join(temporary, 'tools.mjs')).href)
await require('esbuild').build({ entryPoints: [join(root, 'plugin/src/invocation-text.ts')],
  outfile: join(temporary, 'invocation-text.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22' })
const { isLikelyLegacyResult } = await import(pathToFileURL(join(temporary, 'invocation-text.mjs')).href)

class AttachmentOwner extends Service {
  batches = []
  constructor(ctx) { super(ctx, 'attachments') }
  async saveImages(inputs) {
    this.batches.push(inputs)
    return inputs.map((input, index) => ({ attachmentId: `stored-image-${index}`, mediaType: input.mediaType,
      bytes: input.data.length, width: 1, height: 1 }))
  }
}

test('historical cards rewrite only known legacy envelopes, not arbitrary authored JSON', () => {
  assert.equal(isLikelyLegacyResult('document.validate', { valid: true, mainFile: 'main.typ' }), true)
  assert.equal(isLikelyLegacyResult('render.page', {
    valid: true, page: 1, mainFile: 'main.typ', imageSizePixels: { width: 1, height: 1 }
  }), true)
  assert.equal(isLikelyLegacyResult('skill.read', { available: true, content: '{"answer":42}' }), false)
  assert.equal(isLikelyLegacyResult('document.validate', { answer: 42 }), false)
  assert.equal(isLikelyLegacyResult('retired.command', { valid: true, answer: 42 }), false)
})

async function setup() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AttachmentOwner)
  let callId = 0
  const run = (agent, command, args = {}, signal = new AbortController().signal) => ctx.tools.execute({
    agent, name: 'tylina', arguments: { command, args }, signal, callId: ToolCallId(`tylina-test-${++callId}`)
  })
  return { ctx, run }
}

test(`Harness ${hostVersion} scopes share the complete catalog and keep each tool bound to its calling editor`, async () => {
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
    assert.equal(ctx.tools.schemas(alpha).length, 1)
    assert.equal(ctx.tools.schemas().length, 0)
    const presenter = ctx.tools.get('tylina', alpha)?.presentCall
    assert.equal(typeof presenter, 'function')
    assert.deepEqual(presenter({ command: 'workspace.info', args: {} }), {
      card: 'generic',
      title: 'Inspect workspace',
      kind: 'read',
      rawInput: 'Command: workspace.info\nArguments: none'
    })
    assert.deepEqual(presenter({ command: 'document.setMain', args: { file: 'main.typ' } }), {
      card: 'generic',
      title: 'Set the active Tylina main file after successful compilation.',
      kind: 'edit',
      rawInput: 'Command: document.setMain\nArguments:\nFile: main.typ'
    })
    assert.deepEqual(presenter({ command: 'help', args: {} }), {
      card: 'generic',
      title: 'Discover Tylina capabilities',
      kind: 'read',
      rawInput: 'Command: help\nArguments: none'
    })
    assert.deepEqual(presenter({ command: 'retired.command', args: { legacy: true } }), {
      card: 'generic',
      title: 'Tylina',
      kind: 'other',
      rawInput: 'Command: retired.command\nArguments:\nLegacy: true'
    }, 'replaying an obsolete call keeps a readable generic card instead of throwing')
    const first = await run(alpha, 'workspace.info')
    const second = await run(beta, 'document.validate')
    assert.equal(first.isError, false, JSON.stringify(first))
    assert.equal(second.isError, false, JSON.stringify(second))
    assert.equal(first.value.structuredContent.owner, 'alpha')
    assert.equal(second.value.structuredContent.owner, 'beta')
    assert.deepEqual(first.content, [{ type: 'text', text: 'Alpha document' }],
      'the model receives the readable tool content, not the canonical value serialized as JSON')
    assert.deepEqual(second.content, [{ type: 'text', text: 'Beta document' }])
    assert.ok(!first.content[0].text.includes('"structuredContent"'))
    assert.deepEqual(calls.map((call) => call.owner), ['alpha', 'beta'])
    assert.deepEqual(calls.map(({ name, input }) => ({ name, input })), [
      { name: 'tylina', input: { command: 'workspace.info', args: {} } },
      { name: 'tylina', input: { command: 'document.validate', args: {} } }
    ], 'Harness forwards the public dispatcher instead of removed internal operation names')
    assert.equal((await run({ id: 'alpha' }, 'document.validate')).isError, true, 'an unrelated Agent with a copied string id has no registered tool scope')
    releaseAlpha()
    assert.equal(ctx.tools.schemas(alpha).length, 0)
    assert.equal((await run(alpha, 'workspace.info')).isError, true)
    assert.equal((await run(beta, 'workspace.info')).isError, false)
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
    const rendered = await run(agent, 'render.page', { page: 1 })
    assert.equal(rendered.isError, false)
    assert.deepEqual(rendered.content, [{ type: 'image', attachment: { attachmentId: 'stored-image-0', mediaType: 'image/png', bytes: 3, width: 1, height: 1 } }])
    assert.equal(ctx.attachments.batches.length, 1)
    assert.ok(!JSON.stringify(rendered.value).includes('AQID'), 'raw base64 never enters the durable tool value')
    response = { isError: true, content: [{ type: 'text', text: 'Document service failed' }] }
    const failed = await run(agent, 'document.validate')
    assert.equal(failed.isError, true)
    assert.ok(JSON.stringify(failed).includes('Document service failed'))
    response = { content: [{ type: 'text', text: 'Settled' }] }
    let release
    pending = new Promise((resolve) => { release = resolve })
    const abort = new AbortController()
    let settled = false
    const cancelled = run(agent, 'document.setMain', { file: 'main.typ' }, abort.signal).finally(() => { settled = true })
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

test('legacy SDK JSON envelopes become readable without rewriting authored JSON resources', async () => {
  const { ctx, run } = await setup()
  const agent = { id: 'legacy-results' }
  let failValidation = false
  const owner = ctx.plugin({ inject: ['tools', 'attachments'], apply(ctx) {
    const scope = createScope(ctx, agent)
    registerTylinaEditorTools(scope.ctx, agent.id, async (_name, input) => {
      if (input.command === 'document.validate') {
        const structuredContent = failValidation
          ? { valid: false, mainFile: 'main.typ', diagnostics: [{ severity: 'error', message: 'Unknown variable' }] }
          : { valid: true, mainFile: 'main.typ', diagnostics: [] }
        return { structuredContent, isError: failValidation,
          content: [{ type: 'text', text: JSON.stringify(structuredContent) }] }
      }
      if (input.command === 'render.page') {
        const structuredContent = { valid: true, mainFile: 'main.typ', page: 1, pageCount: 3, ppi: 144,
          width: 800, height: 600, imageSizePixels: { width: 800, height: 600 },
          pageSizePoints: { width: 400, height: 300 } }
        return { structuredContent, content: [
          { type: 'text', text: JSON.stringify(structuredContent) },
          { type: 'image', mimeType: 'image/png', data: Buffer.from([1, 2, 3]).toString('base64') }
        ] }
      }
      if (input.command === 'workspace.info') {
        return {
          structuredContent: { root: '/workspace', mainFile: 'main.typ' },
          content: [{ type: 'text', text: 'x'.repeat(70 * 1024) }]
        }
      }
      if (input.command === 'skill.read' && input.args?.path === '_shared/legacy.md') {
        const structuredContent = {
          available: true, path: '_shared/legacy.md', mediaType: 'text/markdown',
          bytes: 24, content: '# Legacy Skill\nUse it.'
        }
        return { structuredContent, content: [{ type: 'text', text: JSON.stringify(structuredContent) }] }
      }
      return {
        structuredContent: { available: true, path: '_shared/example.json', bytes: 13 },
        content: [{ type: 'text', text: '{"answer":42}' }]
      }
    })
  } })
  await owner
  try {
    const validation = await run(agent, 'document.validate')
    assert.match(validation.content[0].text, /^(?:Document is valid\.|Compilation succeeded: main\.typ\.)/u)
    assert.ok(!validation.content[0].text.includes('"valid"'))
    failValidation = true
    const failedValidation = await run(agent, 'document.validate')
    assert.equal(failedValidation.isError, true)
    assert.match(JSON.stringify(failedValidation), /(?:Document is not valid|Compilation failed)/)
    assert.doesNotMatch(JSON.stringify(failedValidation), /\\"valid\\"/,
      'legacy failures are projected before the Harness turns them into a tool error')
    const page = await run(agent, 'render.page', { page: 1 })
    assert.match(page.content[0].text, /^Rendered page(?:: 1\/3| 1 of main\.typ)/u)
    assert.match(page.content[0].text, /800\s*[×x]\s*600/u)
    assert.match(page.content[0].text, /400\s*[×x]\s*300/u)
    assert.equal(page.content[1].type, 'image')
    const resource = await run(agent, 'skill.read', { path: '_shared/example.json' })
    assert.deepEqual(resource.content, [{ type: 'text', text: '{"answer":42}' }],
      'a JSON Skill resource is authored content, not a legacy result envelope')
    const legacySkill = await run(agent, 'skill.read', { path: '_shared/legacy.md' })
    assert.deepEqual(legacySkill.content, [{ type: 'text', text: '# Legacy Skill\nUse it.' }],
      'legacy Skill envelopes use the shared renderer to preserve their body')
    const bounded = await run(agent, 'workspace.info')
    assert.equal(bounded.isError, false)
    assert.ok(bounded.content[0].text.length <= 64 * 1024)
    assert.match(bounded.content[0].text, /Readable tool output truncated at the model result limit/u)
  } finally { await ctx.fiber.dispose() }
})
