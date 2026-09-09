import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { after, test } from 'node:test'
import { assetsRoot } from '../source.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(join(root, 'plugin/package.json'))
const toolsRequire = createRequire(require.resolve('@deepseek-ai/dsh-tools'))
const load = (name) => import(pathToFileURL(toolsRequire.resolve(name)).href)
const { Context, Service } = await load('@deepseek-ai/cordis')
const { SystemPrompt, renderContextSections } = await load('@deepseek-ai/dsh-system-prompt')
const { ToolRuntime } = await load('@deepseek-ai/dsh-tools')
const { createScope } = await load('@deepseek-ai/dsh-scope')
await mkdir(join(root, '.benchmarks'), { recursive: true })
const temporary = await mkdtemp(join(root, '.benchmarks/dsh-binding-'))
after(() => rm(temporary, { recursive: true, force: true }))
await require('esbuild').build({ entryPoints: [join(root, 'plugin/src/session-binding.ts')],
  outfile: join(temporary, 'binding.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } })
const { createSessionBinder } = await import(pathToFileURL(join(temporary, 'binding.mjs')).href)
class Attachments extends Service { constructor(ctx) { super(ctx, 'attachments') } }

test('reconnecting registers one current scoped context without queuing chat messages', async () => {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Attachments)
  const injected = []
  const legacy = { source: { kind: 'plugin', plugin: 'tylina', form: 'instructions' },
    content: [{ type: 'text', text: 'Use the old eighteen tools.' }] }
  const agent = { id: 'conversation', session: { deriveMessages: () => [legacy] },
    inbox: { nextStep: injected }, inject: (message) => injected.push(message) }
  agent.ctx = createScope(ctx, agent).ctx
  let opens = 0, closes = 0
  const bind = createSessionBinder({ resolve: async (_id, project) => ({ agent, path: join(temporary, project || 'first') }) },
    join(assetsRoot, 'skills'), { open: () => {
      opens++; return { connection: {}, dispose: async () => { closes++ } }
    } })
  const sections = async () => renderContextSections(await ctx.systemPrompt.assemble({ scope: agent }))
  let first
  try {
    for (let index = 0; index < 6; index++) {
      const binding = await bind(agent.id, async () => ({ content: [] }), new AbortController().signal)
      try {
        assert.deepEqual(injected, [], 'reconnection must not append connection notices or instructions to chat')
        const current = await sections()
        assert.equal(current.length, 1)
        assert.equal(current[0].name, 'tylina')
        assert.ok(current[0].text.includes('one tool named `tylina`'))
        assert.ok(current[0].text.includes('Use your own harness tools'))
        assert.ok(!current[0].text.includes('Read and change the live document through Tylina tools'))
        assert.ok(current[0].text.includes(join(temporary, 'first')))
        first ??= current
        assert.deepEqual(current, first, 'DSH can deduplicate an unchanged context across reconnects')
        assert.deepEqual(ctx.tools.schemas(agent).map((tool) => tool.name), ['tylina'])
        assert.deepEqual(renderContextSections(await ctx.systemPrompt.assemble()), [], 'context is not global')
      } finally { await binding.dispose() }
      assert.deepEqual(await sections(), [])
      assert.deepEqual(ctx.tools.schemas(agent), [])
    }
    const changed = await bind(agent.id, async () => ({ content: [] }), new AbortController().signal, 'second')
    try {
      const current = await sections()
      assert.ok(current[0].text.includes(join(temporary, 'second')))
      assert.notDeepEqual(current, first, 'a workspace change must supply an updated snapshot')
    } finally { await changed.dispose() }
    assert.equal(opens, closes)
  } finally { await ctx.fiber.dispose() }
})
