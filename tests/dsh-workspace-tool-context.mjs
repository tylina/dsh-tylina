import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { after, test } from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(join(root, 'plugin/package.json'))
await mkdir(join(root, '.benchmarks'), { recursive: true })
const temporary = await mkdtemp(join(root, '.benchmarks/dsh-workspace-tool-context-'))
after(() => rm(temporary, { recursive: true, force: true }))
await require('esbuild').build({
  entryPoints: [join(root, 'plugin/src/workspace-tool-context.ts')],
  outfile: join(temporary, 'context.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22'
})
const { withWorkspaceToolContext } = await import(pathToFileURL(join(temporary, 'context.mjs')).href)

test('workspace info exposes the Harness provider root through the unified dispatcher', async () => {
  const calls = []
  const result = {
    structuredContent: { root: '/workspaces/private', mainFile: 'main.typ' },
    content: [{ type: 'text', text: 'private editor result' }]
  }
  const call = withWorkspaceToolContext(async (name, input) => {
    calls.push({ name, input })
    return result
  }, '/host/project')
  const input = { command: 'workspace.info', args: {} }
  const mapped = await call('tylina', input, new AbortController().signal)
  assert.deepEqual(calls, [{ name: 'tylina', input }])
  assert.deepEqual(mapped.structuredContent, { root: '/host/project', mainFile: 'main.typ' })
  assert.equal(mapped.content[0].text, [
    'Workspace: /host/project',
    'Main file: main.typ',
    'Known files: ? Typst source(s), ? resource(s)'
  ].join('\n'))

  const other = await call('tylina', { command: 'document.validate', args: {} }, new AbortController().signal)
  assert.equal(other, result, 'unrelated command results are unchanged')
})
