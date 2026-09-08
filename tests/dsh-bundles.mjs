import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import { once } from 'node:events'
import { access, cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { constants, createReadStream } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { verifyDock } from './dsh-dock.mjs'
import { verifyBetterSidebar } from './dsh-better-sidebar.mjs'
import { verifySessionFollowing } from './dsh-session-follow.mjs'
import { verifyInstalledMcp } from './dsh-mcp-installed.mjs'
import { verifyWindowRecovery } from './dsh-window-recovery.mjs'
import { verifyToolReconnect } from './dsh-tool-reconnect.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(join(root, 'package.json'))
const { chromium, expect } = require('@playwright/test')
const run = promisify(execFile)
const betterSidebar = process.env.TYLINA_DSH_BETTER_SIDEBAR === '1'
const modes = process.argv.slice(2).length ? process.argv.slice(2) : ['wasm', 'native']
const installOptions = process.env.TYLINA_DSH_OFFLINE === '1' ? ['--offline'] : []
const digest = async (path) => {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(path)) hash.update(bytes)
  return hash.digest('hex')
}
await mkdir(join(root, '.benchmarks'), { recursive: true })

for (const mode of modes) {
  assert.ok(['wasm', 'native'].includes(mode))
  const packageName = mode === 'wasm' ? 'dsh-tylina' : 'dsh-tylina-native'
  const version = JSON.parse(await readFile(join(root, `bundle-${mode}/package.json`), 'utf8')).version
  const home = await mkdtemp(join(root, `.benchmarks/dsh-${mode}-`))
  const env = { ...process.env, DSH_HOME: home }
  const project = join(home, 'project')
  await mkdir(project)
  const source = '#let title="Tylina in dsh"\r\n= #title\r\n\r\nHello 世界'
  await writeFile(join(project, 'Plugin.typ'), source)
  const archive = join(root, `release/${packageName}-${version}.tgz`)
  await access(archive)
  const candidates = {
    ...JSON.parse(process.env.TYLINA_DSH_PACKAGE_OVERRIDES ?? '{}'),
    ...(process.env.TYLINA_DSH_WEB_ASSETS && { 'tylina-web-assets': process.env.TYLINA_DSH_WEB_ASSETS }),
    ...(mode === 'native' && process.env.TYLINA_DSH_NATIVE_RUNTIME && {
      [`tylina-native-${process.platform}-${process.arch}`]: process.env.TYLINA_DSH_NATIVE_RUNTIME
    })
  }
  if (Object.keys(candidates).length) {
    // DSH preserves existing profile files. Resolve candidates from the first install,
    // including unpublished resource dependencies, rather than replacing an old install.
    const directory = join(home, 'profiles/tylina')
    await mkdir(directory, { recursive: true })
    for (const path of Object.values(candidates)) {
      assert.equal(typeof path, 'string')
      await access(path)
    }
    await writeFile(join(directory, 'pnpm-workspace.yaml'),
      'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\noverrides:\n' +
      Object.entries(candidates).map(([name, path]) => `  ${JSON.stringify(name)}: ${JSON.stringify(`file:${path}`)}\n`).join(''))
  }
  await run('dsh', ['plugin', '--profile', 'tylina', 'add', archive, ...installOptions], { env, maxBuffer: 2 ** 20 })
  if (betterSidebar) {
    const configuration = join(home, 'profiles/tylina/pnpm-workspace.yaml')
    await writeFile(configuration, await readFile(configuration, 'utf8') + '\nallowBuilds:\n  node-pty: true\n')
    await run('dsh', ['plugin', '--profile', 'tylina', 'add', 'dsh-better-sidebar@0.18.0', ...installOptions], { env, maxBuffer: 2 ** 20 })
  }
  const probe = join(home, 'probe')
  await mkdir(probe)
  await cp(join(root, 'tests/dsh-probe.mjs'), join(probe, 'index.mjs'))
  await cp(join(root, 'tests/dsh-model-fixture.mjs'), join(probe, 'dsh-model-fixture.mjs'))
  await createRequire(join(root, 'plugin/package.json'))('esbuild').build({ entryPoints: [join(root, 'tests/command-input.mjs')],
    outfile: join(probe, 'command-input.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22' })
  await writeFile(join(probe, 'package.json'), JSON.stringify({ name: 'tylina-acceptance-probe', version: '1.0.0', type: 'module',
    dependencies: { '@deepseek-ai/dsh-llm': '0.1.2-rc.1' },
    exports: './index.mjs', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  await writeFile(join(probe, 'cordis.patch.yml'), '- insert:\n    - id: tylina-acceptance\n      name: tylina-acceptance-probe\n')
  await run('pnpm', ['pack', '--pack-destination', home], { cwd: probe, env, maxBuffer: 2 ** 20 })
  await run('dsh', ['plugin', '--profile', 'tylina', 'add', join(home, 'tylina-acceptance-probe-1.0.0.tgz'), ...installOptions], { env, maxBuffer: 2 ** 20 })
  const profile = join(home, 'profiles/tylina/package.json')
  const manifest = JSON.parse(await readFile(profile, 'utf8'))
  manifest.dsh.profile.bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', packageName, 'tylina-acceptance-probe', ...(betterSidebar ? ['dsh-better-sidebar'] : [])]
  await writeFile(profile, JSON.stringify(manifest, null, 2) + '\n')
  if (process.env.TYLINA_DSH_WEB_ASSETS) {
    assert.equal(await readFile(join(home, 'profiles/tylina/node_modules/tylina-web-assets/web/embed.html'), 'utf8'),
      await readFile(join(process.env.TYLINA_DSH_WEB_ASSETS, 'web/embed.html'), 'utf8'), 'the test must install the candidate Web assets')
  }
  if (mode === 'native') {
    const runtimeRequire = createRequire(join(home, 'profiles/tylina/node_modules/dsh-tylina-native/package.json'))
    const runtimeRoot = dirname(runtimeRequire.resolve(`tylina-native-${process.platform}-${process.arch}/package.json`))
    for (const binary of ['tinymist', 'tylina-tinymist']) {
      const name = binary + (process.platform === 'win32' ? '.exe' : '')
      await access(join(runtimeRoot, 'runtime', name), process.platform === 'win32' ? constants.F_OK : constants.X_OK)
      if (process.env.TYLINA_DSH_NATIVE_RUNTIME) assert.equal(await digest(join(runtimeRoot, 'runtime', name)),
        await digest(join(process.env.TYLINA_DSH_NATIVE_RUNTIME, 'runtime', name)), 'the test must install the candidate Native engine')
    }
  }
  const server = spawn('dsh', ['--profile', 'tylina', '--host', '127.0.0.1', '--port', '0', '--no-open'], { env, cwd: project, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  let resolveUrl, rejectUrl
  const urlReady = new Promise((resolve, reject) => { resolveUrl = resolve; rejectUrl = reject })
  const timer = setTimeout(() => rejectUrl(new Error('dsh startup timed out')), 30_000)
  server.stdout.on('data', (chunk) => {
    output += chunk
    const match = output.match(/dsh web: (http:\/\/\S+)/u)
    if (match) { clearTimeout(timer); resolveUrl(match[1]) }
  })
  server.stderr.on('data', (chunk) => { output += chunk })
  server.on('exit', () => { clearTimeout(timer); rejectUrl(new Error('dsh exited before startup')) })
  let browser
  let page
  const errors = [], diagnostics = []
  const expectedMissing = new Set(['output/Agent.pdf'])
  try {
    const url = await urlReady
    const origin = new URL(url).origin
    assert.equal((await fetch(`${origin}/tylina/`)).status, 401, 'the app must require the Harness session')
    browser = await chromium.launch({ headless: Boolean(process.env.CI) })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] })
    context.on('page', (owner) => {
      owner.on('pageerror', (error) => { errors.push(error.message) })
      owner.on('console', (message) => {
        if (message.type() === 'error' && diagnostics.length < 256) diagnostics.push({ kind: 'console', text: message.text() })
      })
      owner.on('requestfailed', (request) => {
        const url = new URL(request.url())
        if (diagnostics.length < 256) diagnostics.push({ kind: 'request', path: url.pathname, error: request.failure()?.errorText })
      })
      owner.on('response', (response) => {
        if (response.status() < 400 || diagnostics.length >= 256) return
        const url = new URL(response.url())
        diagnostics.push({ kind: 'http', path: url.pathname, status: response.status(), read: url.searchParams.get('read') })
      })
    })
    await context.addInitScript(() => {
      if (location.protocol === 'http:' || location.protocol === 'https:') localStorage.setItem('tylina.locale', 'en')
    })
    page = await context.newPage()
    const sockets = []
    const editorSockets = []
    page.on('websocket', (socket) => { if (socket.url().includes('/tylina/runtime')) sockets.push(socket) })
    page.on('websocket', (socket) => { if (new URL(socket.url()).pathname === '/tylina/editor') editorSockets.push(socket) })
    let openedSession
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname === '/tylina/project') openedSession = url.searchParams.get('session')
    })
    await page.goto(url)
    const continueButton = page.getByRole('button', { name: /^(继续|Continue)$/u })
    await continueButton.click()
    await page.getByRole('button', { name: /^(稍后配置|Set up later|Configure later)$/u }).click()
    await page.evaluate(async () => {
      const response = await fetch('/tylina-acceptance', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bootstrap' }) })
      if (!response.ok) throw new Error(await response.text())
    })
    await page.reload()
    const configure = page.getByRole('button', { name: /^(稍后配置|Set up later|Configure later)$/u })
    await expect.poll(async () => await configure.isVisible() || await page.getByRole('button', { name: /^(打开 Tylina|Open Tylina)$/u }).isVisible()).toBe(true)
    if (await configure.isVisible()) await configure.click()
    const revealConversations = page.getByRole('button', { name: /^(打开侧边栏|Open sidebar)$/u })
    if (await revealConversations.isVisible()) await revealConversations.click()
    const projectGroup = page.getByRole('treeitem').filter({ has: page.getByText('project', { exact: true }) }).first()
    await expect.poll(async () => {
      if (await projectGroup.getAttribute('aria-expanded') !== 'true') await projectGroup.click()
      return page.getByText('Conversation A', { exact: true }).isVisible()
    }).toBe(true)
    await page.getByText('Conversation A', { exact: true }).click()
    const firstProject = page.waitForResponse((response) => new URL(response.url()).pathname === '/tylina/project')
    void firstProject.catch(() => undefined)
    await page.getByRole('button', { name: /^(打开 Tylina|Open Tylina)$/u }).click()
    const initialProject = await (await firstProject).json()
    assert.ok((initialProject.workspace.filePaths ?? Object.keys(initialProject.workspace.files)).includes('Plugin.typ'), JSON.stringify(initialProject))
    await expect(page.locator('.tylina-dsh-panel iframe')).toBeVisible({ timeout: 30_000 })
    const sessionId = openedSession
    assert.ok(sessionId)
    const iframe = page.locator('.tylina-dsh-panel iframe')
    const frame = await iframe.contentFrame()
    const menu = async (group, item) => {
      const top = frame.getByRole('button', { name: group, exact: true })
      if (await top.isVisible()) await top.click()
      else {
        await frame.getByRole('button', { name: 'Main menu', exact: true }).click()
        await frame.getByRole('menuitem', { name: group, exact: true }).click()
      }
      await frame.getByRole('menuitem', { name: item, exact: true }).click()
    }
    await frame.getByTitle('Plugin.typ', { exact: true }).dblclick()
    await expect(frame.locator('.typst-doc')).toBeVisible({ timeout: 30_000 })
    await expect(frame.locator('.web-document-title')).toHaveText('project')
    const drawerClosed = await frame.getByTestId('tylina-root').getAttribute('data-workspace-sidebar-collapsed') === 'true'
    if (drawerClosed) await frame.getByRole('button', { name: 'Sidebar', exact: true }).click()
    await expect(frame.locator('.workspaceCurrentTitle')).toHaveText('project')
    if (drawerClosed) await frame.getByRole('button', { name: 'Sidebar', exact: true }).click()
    const readMain = () => readFile(join(project, 'Plugin.typ'), 'utf8')
    const probeRequest = (input) => page.evaluate(async (input) => {
      const response = await fetch('/tylina-acceptance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
      if (!response.ok) throw new Error(await response.text())
      return response.json()
    }, { sessionId, ...input })
    await expect.poll(async () => (await probeRequest({ action: 'catalog' })).filter((tool) => tool.name === 'tylina').length).toBe(1)
    const validated = await probeRequest({ name: 'tylina_validate_document' })
    assert.equal(validated.isError, false)
    assert.equal(validated.value.structuredContent.valid, true)
    await verifyInstalledMcp({ page, frame, root, project, readMain, mode, expectedMissing })
    await verifyToolReconnect({ page, frame, root, mode, readMain, probeRequest, editorSockets, expect, expectedMissing })
    const info = (await probeRequest({ name: 'tylina_workspace_info' })).value.structuredContent
    assert.equal(info.root, project)
    await access(join(info.skillsRoot, 'typst-slides/scripts/rotate_images.py'))
    const runtime = (await probeRequest({ name: 'tylina_tool_runtime' })).value.structuredContent
    assert.equal(runtime.status, 'ready')
    assert.equal(runtime.workspaceRoot, project)
    assert.equal(runtime.skillsRoot, info.skillsRoot)
    assert.match((await run(runtime.uvExecutable, ['--version'], { env: { ...env, ...runtime.environment }, cwd: project })).stdout, /^uv /u)
    await expect.poll(readMain).toBe(source)
    await menu('Format', 'Format Document')
    await expect.poll(readMain).toContain('#let title = "Tylina in dsh"')
    const formatted = await readMain()
    assert.ok(formatted.includes('\r\n'))
    await menu('Edit', 'Undo'); await expect.poll(readMain).toBe(source)
    await menu('Edit', 'Redo'); await expect.poll(readMain).toBe(formatted)
    const viewReply = await probeRequest({ name: 'tylina', input: { command: 'view.state' } })
    assert.equal(viewReply.isError, false, JSON.stringify(viewReply))
    const viewState = viewReply.value.structuredContent
    assert.equal(typeof viewState.workspace, 'boolean')
    const splitView = await probeRequest({ name: 'tylina', input: { command: 'view.set', args: { target: 'mode', value: 'split' } } })
    assert.equal(splitView.isError, false)
    assert.equal(splitView.value.structuredContent.mode, 'split')
    await frame.getByTestId('monaco-source-editor').click({ position: { x: 180, y: 12 } })
    await page.keyboard.press('ControlOrMeta+a')
    const selection = (await probeRequest({ name: 'tylina', input: { command: 'editor.state' } })).value.structuredContent
    assert.equal(selection.surface, 'source')
    assert.equal(selection.selection.text, formatted)
    assert.equal(selection.selection.file, 'Plugin.typ')
    assert.equal(selection.selection.kind, 'source')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
    const edited = formatted + ' updated'
    await page.keyboard.insertText(' updated')
    await expect.poll(readMain).toBe(edited)
    const read = (await probeRequest({ name: 'tylina_read_file', input: { file: 'Plugin.typ' } })).value.structuredContent
    const agentEdited = edited + ' Agent tool'
    assert.equal((await probeRequest({ name: 'tylina_write_file', input: {
      file: 'Plugin.typ', contents: agentEdited, expectedSha256: read.sha256
    } })).isError, false)
    await expect.poll(readMain).toBe(agentEdited)
    await menu('Edit', 'Undo'); await expect.poll(readMain).toBe(edited)
    await menu('Edit', 'Redo'); await expect.poll(readMain).toBe(agentEdited)
    const external = agentEdited + '\r\n\r\nExternal Harness edit'
    await writeFile(join(project, 'Plugin.typ'), external)
    await expect.poll(async () => (await probeRequest({ name: 'tylina_read_file', input: { file: 'Plugin.typ' } })).value.structuredContent.text).toBe(external)
    await menu('Edit', 'Undo'); await expect.poll(readMain).toBe(agentEdited)
    await menu('Edit', 'Redo'); await expect.poll(readMain).toBe(external)
    await frame.getByRole('button', { name: 'Agent', exact: true }).click()
    await expect(iframe).toBeVisible()
    await page.getByRole('button', { name: /^(隐藏编辑器|Hide editor)$/u }).click()
    await expect(iframe).toBeHidden()
    await expect(page.getByRole('button', { name: /^(打开 Tylina|Open Tylina)$/u })).toBeFocused()
    await expect(frame.locator('.workspaceAgentDock')).toHaveCount(0)
    const rendered = await probeRequest({ name: 'tylina_render_page', input: { page: 1 } })
    assert.equal(rendered.isError, false)
    assert.ok(rendered.content.some((part) => part.type === 'image' && part.attachment?.attachmentId), 'the hidden live editor renders into real Harness attachments')
    await page.getByRole('button', { name: /^(打开 Tylina|Open Tylina)$/u }).click()
    await expect.poll(readMain).toBe(external)
    assert.equal(sockets.length, mode === 'native' ? 1 : 0, 'hiding the editor must retain its runtime')
    await expect(frame.locator('.typst-doc')).toBeVisible()
    await page.screenshot({ path: join(root, `.benchmarks/dsh-${mode}.png`) })
    await (betterSidebar ? verifyBetterSidebar : verifyDock)({ page, frame, iframe, context, root, mode, readMain, probeRequest, expect, external, menu })
    await verifySessionFollowing({ page, frame, home, probeRequest, readMain, external, expect })
    await page.reload()
    const setup = page.getByRole('button', { name: /^(稍后配置|Set up later|Configure later)$/u })
    const launcher = page.getByRole('button', { name: /^(打开 Tylina|Open Tylina)$/u })
    await expect.poll(async () => await setup.isVisible() || await launcher.isVisible()).toBe(true)
    if (await setup.isVisible()) await setup.click()
    if (mode === 'native' && process.platform !== 'win32') {
      await expect.poll(async () => {
        const { stdout } = await run('ps', ['-axo', 'ppid=,comm='])
        return stdout.split('\n').filter((line) => {
          const [parent, ...command] = line.trim().split(/\s+/u)
          return parent === String(server.pid) && command.join(' ').includes('/runtime/')
        }).length
      }).toBe(0)
    }
    // Better Sidebar restores its open tab on reload; the ordinary dock starts closed.
    if (await launcher.getAttribute('aria-expanded') !== 'true') await launcher.click()
    await expect.poll(readMain).toBe(external)
    await expect(frame.locator('.typst-doc')).toBeVisible()
    await expect(frame.locator('.web-document-title')).toHaveText('project')
    assert.deepEqual(errors, [])
    await expect.poll(async () => (await probeRequest({ action: 'catalog' })).filter((tool) => tool.name === 'tylina').length).toBe(1)
    const instructions = await probeRequest({ action: 'instructions' })
    assert.equal([...instructions.pending, ...instructions.recorded].filter((message) => message.source.form === 'instructions').length, 1)
    assert.equal(instructions.status, 'idle', 'opening a document does not start an inference task')
    for (const marker of ['Agent loop verified.', 'Continued after compaction.']) {
      if (marker.startsWith('Continued')) await probeRequest({ action: 'compact' })
      await probeRequest({ action: 'turn', marker })
      await expect.poll(async () => {
        const state = await probeRequest({ action: 'model' })
        if (state.error) throw new Error(state.error)
        return state.complete && state.status === 'idle'
      }, { timeout: 60_000 }).toBe(true)
      const state = await probeRequest({ action: 'model' })
      assert.equal(state.requests.length, 6)
      await expect.poll(readMain).toBe(state.expected)
      const pdf = await readFile(join(project, 'output/Agent.pdf'))
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
    }
    page = await verifyWindowRecovery({ page, context, root, mode, sessionId, readMain, expect })
    await expect(page.locator('.tylina-dsh-error')).toHaveCount(0)
    assert.deepEqual(errors, [], 'all editor and detached windows must finish without uncaught browser errors')
    assert.deepEqual(diagnostics.filter((entry) => entry.kind === 'http' && !(
      entry.path === '/tylina/project' && (entry.status === 503 || entry.status === 404 && expectedMissing.has(entry.read))
    )), [], 'only the injected save failure and explicitly checked missing files may return HTTP errors')
    assert.deepEqual(diagnostics.filter((entry) => entry.kind === 'console' && !entry.text.startsWith('Failed to load resource:')),
      [], 'the host console must not contain application errors')
    assert.deepEqual(diagnostics.filter((entry) => entry.kind === 'request' && entry.error !== 'net::ERR_ABORTED'),
      [], 'retired request cancellation is expected; other network failures are not')
    console.log(`PASS ${mode}: packed install, actual Agent loop and projects, compile/format, disk saves, external Undo, PDF/PNG/SVG export, image receipts, context replacement, host Agent navigation, hide/reopen, reload and disposal`)
  } catch (error) {
    if (page) { const url = new URL(page.url()); console.error('Failed page:', url.origin + url.pathname); console.error((await page.locator('body').innerText().catch(() => '')).slice(0, 1800)) }
    await page?.screenshot({ path: join(root, `.benchmarks/dsh-${mode}-failure.png`) }).catch(() => undefined)
    throw error
  } finally {
    clearTimeout(timer)
    await browser?.close()
    server.kill('SIGINT')
    const killed = setTimeout(() => server.kill('SIGKILL'), 5000)
    if (server.exitCode === null) await once(server, 'exit')
    clearTimeout(killed)
    await writeFile(join(home, 'server.log'), output.replace(/\?token=\S+/gu, '?token=[redacted]'))
    await writeFile(join(home, 'browser-diagnostics.json'), JSON.stringify({ errors, diagnostics }, null, 2) + '\n')
  }
}
