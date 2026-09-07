import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { after, test } from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(join(root, 'plugin/package.json'))
const load = (name) => import(pathToFileURL(require.resolve(name)).href)
const { Context } = await load('@deepseek-ai/cordis')
const { LocalFileSystem } = await load('@deepseek-ai/dsh-fs-local')
const temporary = await mkdtemp(join(root, '.benchmarks/dsh-workspaces-'))
after(() => rm(temporary, { recursive: true, force: true }))
await require('esbuild').build({ entryPoints: [join(root, 'plugin/src/workspaces.ts')],
  outfile: join(temporary, 'workspaces.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22' })
const { createHarnessWorkspaces, resolveHarnessProject } = require(join(temporary, 'workspaces.cjs'))

async function setup(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'tylina-harness-project-')))
  const ctx = new Context()
  await ctx.plugin(LocalFileSystem, { cwd: directory })
  const agentOwner = ctx.plugin(() => undefined)
  await agentOwner
  const agent = { ctx: agentOwner.ctx, session: { header: { cwd: directory } } }
  // Only the session controller boundary is substituted; paths and storage use the released backend and real disk.
  const projects = createHarnessWorkspaces({ sessionController: { async resolveAgent(id) {
    return id === 'owner' ? { agent } : { error: { message: 'Unknown session' } }
  } } }, 'wasm')
  const server = createServer((req, res) => { void projects.handle(req, res) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const url = new URL(`http://127.0.0.1:${server.address().port}/tylina/project?session=owner&project=paper`)
  t.after(async () => { await projects.dispose(); await new Promise((resolve) => server.close(resolve)); await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  await mkdir(join(directory, 'paper'))
  await writeFile(join(directory, 'paper', 'main.typ'), '\uFEFF= 原文\r\n')
  return { ctx, directory, url }
}

test('released Harness filesystem maps a selected project into versioned source/resource HTTP storage', async (t) => {
  const { directory, url } = await setup(t)
  const initial = await fetch(url)
  assert.equal(initial.status, 200)
  const first = await initial.json()
  assert.equal(first.workspace.mainFile, null)
  assert.deepEqual(first.workspace.files, { 'main.typ': '\uFEFF= 原文\r\n' })
  assert.equal((await fetch(url, { headers: { 'If-None-Match': initial.headers.get('etag') } })).status, 304)
  const desired = structuredClone(first.workspace)
  desired.files['main.typ'] += '\r\nChanged'
  desired.resources['figure.png'] = Buffer.from([137, 80, 78, 71, 0, 255]).toString('base64')
  const init = { method: 'POST', headers: { Origin: url.origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace: desired, revision: first.revision }) }
  assert.equal((await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } })).status, 403)
  const saved = await fetch(url, init)
  assert.equal(saved.status, 200)
  const version = (await saved.json()).revision
  assert.equal(await readFile(join(directory, 'paper', 'main.typ'), 'utf8'), desired.files['main.typ'])
  assert.equal((await readFile(join(directory, 'paper', 'figure.png'))).toString('base64'), desired.resources['figure.png'])
  await writeFile(join(directory, 'paper', 'main.typ'), 'External shell edit')
  assert.equal((await fetch(url, { ...init, body: JSON.stringify({ workspace: desired, revision: version }) })).status, 409)
  const latest = await (await fetch(url)).json()
  assert.equal(latest.workspace.files['main.typ'], 'External shell edit')
  assert.notEqual(latest.revision, version)
})

test('filesystem admission uses the Agent provider and rejects unmapped worlds, unknown sessions and escaping project paths', async (t) => {
  const { ctx, directory, url } = await setup(t)
  assert.equal(await resolveHarnessProject(ctx.fs, directory, 'paper'), join(directory, 'paper'))
  await assert.rejects(resolveHarnessProject({
    resolve: ctx.fs.resolve.bind(ctx.fs), processPath: ctx.fs.processPath.bind(ctx.fs), processPathFromHostPath: () => undefined
  }, directory, 'paper'), /shared host directory/)
  url.searchParams.set('project', '../escape')
  assert.equal((await fetch(url)).status, 400)
  url.searchParams.set('project', '.git')
  assert.equal((await fetch(url)).status, 400)
  url.searchParams.set('session', 'unknown')
  assert.equal((await fetch(url)).status, 400)
})
