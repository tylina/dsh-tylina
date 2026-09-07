import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(join(root, 'plugin/package.json'))
const temporary = await mkdtemp(join(root, '.benchmarks/workspace-views-'))
after(() => rm(temporary, { recursive: true, force: true }))
await require('esbuild').build({ stdin: { contents: `export { createWorkspaceViews } from './src/workspace-views';
  export { createNodeWorkspacePool, createNodeWorkspaceFileSystem } from 'tylina-sdk/node'`, resolveDir: join(root, 'plugin') },
  outfile: join(temporary, 'views.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22' })
const { createWorkspaceViews, createNodeWorkspacePool, createNodeWorkspaceFileSystem } = require(join(temporary, 'views.cjs'))

async function setup(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'tylina-view-')))
  await writeFile(join(directory, 'main.typ'), 'Document')
  const pool = createNodeWorkspacePool({ lazy: true })
  const views = createWorkspaceViews(pool, 1000)
  const fs = createNodeWorkspaceFileSystem(directory)
  t.after(async () => { await views.dispose(); await pool.dispose(); await rm(directory, { recursive: true, force: true }) })
  return { directory, views, fs }
}

test('view disposal waits for an admitted save and retains a second view of the same workspace', async (t) => {
  const { directory, views, fs } = await setup(t)
  const first = await views.use('first', directory, fs, async (store) => store)
  assert.equal(await views.use('second', directory, fs, async (store) => store), first)
  const snapshot = await first.read({ mainFile: 'main.typ' })
  let started, proceed
  const admitted = new Promise((resolve) => { started = resolve })
  const gate = new Promise((resolve) => { proceed = resolve })
  const saving = views.use('first', directory, fs, async (store) => {
    started(); await gate
    snapshot.workspace.files['main.typ'] = 'Saved before disposal'
    return store.save(snapshot.workspace, snapshot.revision)
  })
  await admitted
  let released = false
  const closing = views.release('first').then(() => { released = true })
  await Promise.resolve()
  assert.equal(released, false)
  proceed(); await saving; await closing
  assert.equal((await first.read({ mainFile: 'main.typ' })).workspace.files['main.typ'], 'Saved before disposal')
  await views.release('second')
  await assert.rejects(first.read(), /closed/)
})

test('idle cleanup releases forgotten views but cannot expire an active operation', async (t) => {
  const { directory, views, fs } = await setup(t)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const first = await views.use('view', directory, fs, async (store) => store)
  let started, proceed
  const admitted = new Promise((resolve) => { started = resolve })
  const gate = new Promise((resolve) => { proceed = resolve })
  const active = views.use('view', directory, fs, async (store) => { started(); await gate; return store.read() })
  await admitted
  t.mock.timers.tick(2000)
  proceed(); await active
  await first.read()
  t.mock.timers.tick(1000)
  const reopened = await views.use('view', directory, fs, async (store) => store)
  assert.notEqual(reopened, first)
  await assert.rejects(first.read(), /closed/)
})

test('a view cannot silently retarget when its conversation changes directory', async (t) => {
  const { directory, views, fs } = await setup(t)
  const other = join(directory, 'other'); await mkdir(other)
  await views.use('view', directory, fs, async (store) => store.read())
  await assert.rejects(views.use('view', other, fs, async (store) => store.read()), /changed its working directory/)
  await views.dispose()
  await assert.rejects(views.use('view', directory, fs, async (store) => store.read()), /closed/)
})
