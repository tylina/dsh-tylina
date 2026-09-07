import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile, symlink, truncate } from 'node:fs/promises'
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
await mkdir(join(root, '.benchmarks'), { recursive: true })
const temporary = await mkdtemp(join(root, '.benchmarks/dsh-workspaces-'))
after(() => rm(temporary, { recursive: true, force: true }))
await require('esbuild').build({ entryPoints: [join(root, 'plugin/src/workspaces.ts')],
  outfile: join(temporary, 'workspaces.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22' })
const { createHarnessWorkspaces, resolveHarnessProject } = require(join(temporary, 'workspaces.cjs'))

async function setup(t, mode = 'wasm') {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'tylina-harness-project-')))
  const ctx = new Context()
  await ctx.plugin(LocalFileSystem, { cwd: directory })
  const agentOwner = ctx.plugin(() => undefined)
  await agentOwner
  const agent = { ctx: agentOwner.ctx, session: { header: { cwd: directory } } }
  // Only the session controller boundary is substituted; paths and storage use the released backend and real disk.
  let routed = 0
  const projects = createHarnessWorkspaces({ fs: ctx.fs, sessions: { get(id) { return ['owner', 'cold-child'].includes(id) ? agent.session : undefined } }, get() { return undefined },
    agents: { get(id) { return id === 'child' ? agent : undefined } }, sessionController: { async resolveAgent(id) {
    routed++
    return id === 'owner' ? { agent } : { error: { message: 'Unknown session' } }
  } } }, mode)
  const server = createServer((req, res) => { void projects.handle(req, res) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const url = new URL(`http://127.0.0.1:${server.address().port}/tylina/project?session=owner&project=paper`)
  url.searchParams.set('view', randomUUID())
  t.after(async () => { await projects.dispose(); await new Promise((resolve) => server.close(resolve)); await ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) })
  await mkdir(join(directory, 'paper'))
  await writeFile(join(directory, 'paper', 'main.typ'), '\uFEFF= 原文\r\n')
  return { ctx, directory, url, routed: () => routed }
}

test('released Harness filesystem maps a selected project into versioned source/resource HTTP storage', async (t) => {
  const { directory, url } = await setup(t)
  const initial = await fetch(url)
  assert.equal(initial.status, 200)
  const first = await initial.json()
  assert.equal(first.workspace.mainFile, null)
  assert.deepEqual(first.workspace.files, {})
  assert.deepEqual(first.workspace.filePaths, ['main.typ'])
  assert.equal((await fetch(url, { headers: { 'If-None-Match': initial.headers.get('etag') } })).status, 304)
  const desired = structuredClone(first.workspace)
  const fileUrl = new URL(url); fileUrl.searchParams.set('read', 'main.typ')
  desired.files['main.typ'] = await (await fetch(fileUrl)).text() + '\r\nChanged'
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

for (const mode of ['wasm', 'native']) test(`${mode} discovers one directory and releases its workspace when the view closes`, async (t) => {
  const { directory, url } = await setup(t, mode)
  await mkdir(join(directory, 'paper', 'chapters'))
  await writeFile(join(directory, 'paper', 'chapters', 'part.typ'), 'Nested document')
  const first = await (await fetch(url)).json()
  assert.deepEqual(first.workspace.filePaths, ['main.typ'])
  const listing = new URL(url); listing.searchParams.set('directory', 'chapters')
  const entries = await (await fetch(listing)).json()
  assert.deepEqual(entries.map((entry) => entry.name), ['part.typ'])
  const discovered = await (await fetch(url)).json()
  assert.equal(discovered.revision, first.revision)
  assert.ok(discovered.workspace.filePaths.includes('chapters/part.typ'))
  assert.deepEqual(discovered.workspace.files, {})
  const desired = structuredClone(first.workspace)
  const reading = new URL(url); reading.searchParams.set('read', 'main.typ')
  assert.equal((await fetch(reading)).status, 200)
  desired.files['main.typ'] = 'Edited while discovery completes'
  assert.equal((await fetch(url, { method: 'POST', headers: { Origin: url.origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace: desired, revision: first.revision }) })).status, 200)
  assert.equal(await readFile(join(directory, 'paper', 'chapters', 'part.typ'), 'utf8'), 'Nested document')
  const current = await (await fetch(url)).json()
  current.workspace.filePaths = current.workspace.filePaths.filter((path) => path !== 'chapters/part.typ')
  assert.equal((await fetch(url, { method: 'POST', headers: { Origin: url.origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace: current.workspace, revision: current.revision,
      removals: { removedFiles: ['chapters/part.typ'], removedFolders: [] } }) })).status, 200)
  await assert.rejects(readFile(join(directory, 'paper', 'chapters', 'part.typ')), { code: 'ENOENT' })
  assert.equal((await fetch(url, { method: 'DELETE', headers: { Origin: url.origin } })).status, 204)
  const reopened = await (await fetch(url)).json()
  assert.notEqual(reopened.revision, current.revision)
  assert.deepEqual(reopened.workspace.files, {}, 'the old materialized working set was released')
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

test('file viewer entry paths open the exact Typst main inside the admitted project', async (t) => {
  const { directory, url } = await setup(t)
  await mkdir(join(directory, 'paper', 'chapters'))
  await writeFile(join(directory, 'paper', 'chapters', 'talk.typ'), '= Talk')
  for (const entry of ['chapters/talk.typ', join(directory, 'paper', 'chapters', 'talk.typ')]) {
    url.searchParams.set('entry', entry)
    const response = await fetch(url)
    assert.equal(response.status, 200)
    const { workspace } = await response.json()
    assert.equal(workspace.mainFile, 'chapters/talk.typ')
    assert.equal(workspace.activeFile, 'chapters/talk.typ')
  }
  for (const entry of ['../outside.typ', join(directory, 'outside.typ'), 'missing.typ']) {
    url.searchParams.set('entry', entry)
    assert.equal((await fetch(url)).status, 400)
  }
})


test('an active child session opens a large filesystem through its existing scope without session routing', async (t) => {
  const { directory, url, routed } = await setup(t)
  await mkdir(join(directory, 'paper', '.agents'))
  await symlink(directory, join(directory, 'paper', '.agents', 'skills'))
  await writeFile(join(directory, 'paper', 'unrelated.bin'), '')
  await truncate(join(directory, 'paper', 'unrelated.bin'), 256 * 1024 * 1024)
  url.searchParams.set('session', 'child'); url.searchParams.set('entry', 'main.typ')
  const response = await fetch(url)
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.deepEqual(Object.keys(result.workspace.files), ['main.typ'])
  assert.deepEqual(result.workspace.resources, {})
  assert.ok(result.workspace.filePaths.includes('unrelated.bin'))
  assert.equal(routed(), 0, 'file access must not resume or adopt a live child session')
  const cold = new URL(url); cold.searchParams.set('session', 'cold-child')
  assert.equal((await fetch(cold)).status, 200)
  assert.equal(routed(), 0, 'reading a cold child workspace must not activate its Agent')
  url.searchParams.delete('entry'); url.searchParams.set('read', 'main.typ')
  assert.equal((await fetch(url)).status, 200)
  url.searchParams.set('read', '../outside.typ')
  assert.equal((await fetch(url)).status, 400)
})
