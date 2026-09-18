import { readEditorSource, waitForEditorSource, writeHarnessSource } from './dsh-source.mjs'
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
import { expectPersistedDocumentTab, verifyBetterSidebar } from './dsh-better-sidebar.mjs'
import { verifySessionFollowing } from './dsh-session-follow.mjs'
import { verifyInstalledMcp } from './dsh-mcp-installed.mjs'
import { verifyWindowRecovery } from './dsh-window-recovery.mjs'
import { verifyToolReconnect } from './dsh-tool-reconnect.mjs'
import { verifyLiveModel } from './dsh-live-model.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(join(root, 'package.json'))
const { chromium, expect } = require('@playwright/test')
const run = (...args) => {
  const result = promisify(execFile)(...args)
  // These commands are noninteractive. Let installers observe EOF instead of
  // keeping their input listener alive after they finish installing dependencies.
  result.child.stdin?.end()
  return result
}
const dshBin = process.env.TYLINA_DSH_BIN || 'dsh'
const { stdout: dshVersionOutput } = await run(dshBin, ['--version'], { maxBuffer: 2 ** 20 })
const dshVersion = process.env.TYLINA_DSH_PACKAGE_VERSION ?? dshVersionOutput.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/u)?.[0]
assert.ok(dshVersion, `Could not determine the package version behind ${dshBin}`)
const betterSidebar = process.env.TYLINA_DSH_BETTER_SIDEBAR === '1'
const betterSidebarVersion = process.env.TYLINA_DSH_BETTER_SIDEBAR_VERSION ?? '0.18.0'
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
  if (env.TYLINA_DSH_LIVE_KEY) env.DEEPSEEK_API_KEY = env.TYLINA_DSH_LIVE_KEY
  const project = join(home, 'project')
  await mkdir(project)
  const source = '#let title="Tylina in dsh"\r\n= #title\r\n\r\nHello 世界'
  await writeFile(join(project, 'Plugin.typ'), source)
  await writeFile(join(project, 'source.pdf'), createPdf('Imported through DSH.'))
  const archive = process.env.TYLINA_DSH_BUNDLE_ARCHIVE ?? join(root, `release/${packageName}-${version}.tgz`)
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
  await run(dshBin, ['plugin', '--profile', 'tylina', 'add', archive, ...installOptions], { env, maxBuffer: 2 ** 20 })
  if (betterSidebar) {
    const configuration = join(home, 'profiles/tylina/pnpm-workspace.yaml')
    await writeFile(configuration, await readFile(configuration, 'utf8') + '\nallowBuilds:\n  node-pty: true\n')
    await run(dshBin, ['plugin', '--profile', 'tylina', 'add', `dsh-better-sidebar@${betterSidebarVersion}`, ...installOptions], { env, maxBuffer: 2 ** 20 })
  }
  const probe = join(home, 'probe')
  await mkdir(probe)
  await cp(join(root, 'tests/dsh-probe.mjs'), join(probe, 'index.mjs'))
  await cp(join(root, 'tests/dsh-model-fixture.mjs'), join(probe, 'dsh-model-fixture.mjs'))
  await writeFile(join(probe, 'package.json'), JSON.stringify({ name: 'tylina-acceptance-probe', version: '1.0.0', type: 'module',
    dependencies: { '@deepseek-ai/dsh-llm': dshVersion },
    exports: './index.mjs', dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  await writeFile(join(probe, 'cordis.patch.yml'), '- insert:\n    - id: tylina-acceptance\n      name: tylina-acceptance-probe\n')
  await run('pnpm', ['pack', '--pack-destination', home], { cwd: probe, env, maxBuffer: 2 ** 20 })
  // The product bundle above goes through the real DSH installer. The test-only
  // probe is registered below; install its dependency directly with closed stdin.
  await run('pnpm', ['add', join(home, 'tylina-acceptance-probe-1.0.0.tgz'), ...installOptions], {
    cwd: join(home, 'profiles/tylina'), env, maxBuffer: 2 ** 20
  })
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
  const server = spawn(dshBin, ['--profile', 'tylina', '--host', '127.0.0.1', '--port', '0', '--no-open'], { env, cwd: project, stdio: ['ignore', 'pipe', 'pipe'] })
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
  let phase = 'startup'
  const expectedMissing = new Set(['output/Agent.pdf'])
  try {
    const url = await urlReady
    const origin = new URL(url).origin
    assert.equal((await fetch(`${origin}/tylina/`)).status, 401, 'the app must require the Harness session')
    browser = await chromium.launch({ headless: Boolean(process.env.CI) })
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] })
    context.on('page', (owner) => {
      owner.on('pageerror', (error) => {
        errors.push({ message: error.message, stack: error.stack, path: new URL(owner.url()).pathname })
      })
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
        const request = response.request()
        let write
        if (url.pathname === '/tylina/project' && request.method() === 'POST') {
          const body = request.postDataJSON()
          const source = body.workspace?.files?.[body.workspace?.mainFile]
          write = { revision: body.revision, mainFile: body.workspace?.mainFile,
            sourceLength: typeof source === 'string' ? source.length : null,
            sourcePreview: typeof source === 'string' ? source.slice(0, 512) : null }
        }
        diagnostics.push({ kind: 'http', phase, path: url.pathname,
          status: response.status(), read: url.searchParams.get('read'), ...(write ? { write } : {}) })
      })
    })
    await context.exposeBinding('__tylinaAcceptanceError', ({ frame }, error) => {
      diagnostics.push({ kind: 'window-error', path: new URL(frame.url()).pathname, ...error })
    })
    await context.addInitScript(() => {
      window.addEventListener('error', (event) => {
        void window.__tylinaAcceptanceError({ message: event.message, stack: event.error?.stack,
          source: event.filename, line: event.lineno, column: event.colno, time: Date.now() })
      })
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
    const initialConfigure = page.getByRole('button', { name: /^(稍后配置|Set up later|Configure later)$/u })
    await expect.poll(async () => await initialConfigure.isVisible() ||
      await page.getByRole('button', { name: /^(打开 Tylina|Open Tylina)$/u }).isVisible()).toBe(true)
    if (await initialConfigure.isVisible()) await initialConfigure.click()
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
    const command = (name, args = {}) => probeRequest({
      name: 'tylina',
      input: { command: name, args }
    })
    const requireCleanWorkspace = async () => {
      const result = await command('workspace.save')
      assert.equal(result.isError, false, JSON.stringify(result))
      assert.equal(result.value.structuredContent.saved, true, JSON.stringify(result.value))
      assert.deepEqual(result.content, [{ type: 'text', text: 'Workspace saved.' }],
        'the installed Harness must render concise tool content instead of canonical JSON')
    }
    await expect.poll(async () => (await probeRequest({ action: 'catalog' })).filter((tool) => tool.name === 'tylina').length).toBe(1)
    const validated = await command('document.validate')
    assert.equal(validated.isError, false, JSON.stringify(validated))
    assert.equal(validated.value.structuredContent.valid, true)
    assert.match(validated.content.find((part) => part.type === 'text')?.text ?? '',
      /^(?:Document (?:is )?valid\b|Compilation succeeded: .+\.typ\.)/iu)
    assert.ok(!validated.content.some((part) => part.type === 'text' && part.text.includes('"valid"')),
      'the installed Harness model result must not receive the legacy canonical JSON envelope')
    phase = 'installed-mcp'
    await verifyInstalledMcp({ page, frame, root, project, readMain, mode, expectedMissing, probeRequest,
      mark: (value) => { phase = `installed-mcp:${value}` } })
    assert.deepEqual(diagnostics.filter((entry) => entry.kind === 'http' && entry.status === 409), [],
      'shared document tools and external animation must not leave stale project writes')
    phase = 'tool-reconnect'
    await verifyToolReconnect({ page, frame, root, mode, readMain, probeRequest, editorSockets, expect, expectedMissing })
    phase = 'document-flow'
    const info = (await command('workspace.info')).value.structuredContent
    assert.equal(info.root, project)
    assert.equal(info.skillsRoot, undefined)
    const skill = await command('skill.read', { path: 'typst-slides/SKILL.md' })
    assert.equal(skill.isError, false, JSON.stringify(skill))
    assert.match(skill.value.content.find((entry) => entry.type === 'text')?.text ?? '', /Typst/)
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
    if (betterSidebar && await frame.getByTestId('tylina-root').getAttribute('data-workspace-sidebar-collapsed') !== 'true') {
      await frame.getByRole('button', { name: 'Sidebar', exact: true }).click()
    }
    await frame.getByTestId('monaco-source-editor').click({ position: { x: 20, y: 12 } })
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
    const agentEdited = edited + ' Agent tool'
    await writeHarnessSource(probeRequest, agentEdited)
    await waitForEditorSource(page, probeRequest, agentEdited, expect)
    await expect.poll(readMain).toBe(agentEdited)
    await menu('Edit', 'Undo'); await expect.poll(readMain).toBe(edited)
    await menu('Edit', 'Redo'); await expect.poll(readMain).toBe(agentEdited)
    const external = agentEdited + '\r\n\r\nExternal Harness edit'
    await requireCleanWorkspace()
    await writeHarnessSource(probeRequest, external)
    await waitForEditorSource(page, probeRequest, external, expect)
    await menu('Edit', 'Undo'); await expect.poll(readMain).toBe(agentEdited)
    await menu('Edit', 'Redo'); await expect.poll(readMain).toBe(external)
    await frame.getByRole('button', { name: 'Agent', exact: true }).click()
    await expect(iframe).toBeVisible()
    await page.getByRole('button', { name: /^(隐藏编辑器|Hide editor)$/u }).click()
    await expect(iframe).toBeHidden()
    await expect(page.getByRole('button', { name: /^(打开 Tylina|Open Tylina)$/u })).toBeFocused()
    await expect(frame.locator('.workspaceAgentDock')).toHaveCount(0)
    const rendered = await command('render.page', { page: 1 })
    assert.equal(rendered.isError, false)
    assert.match(rendered.content.find((part) => part.type === 'text')?.text ?? '', /^Rendered page(?:\s|:)/u)
    assert.ok(rendered.content.some((part) => part.type === 'image' && part.attachment?.attachmentId), 'the hidden live editor renders into real Harness attachments')
    await page.getByRole('button', { name: /^(打开 Tylina|Open Tylina)$/u }).click()
    await expect.poll(readMain).toBe(external)
    assert.equal(sockets.length, mode === 'native' ? 1 : 0, 'hiding the editor must retain its runtime')
    await expect(frame.locator('.typst-doc')).toBeVisible()
    await page.screenshot({ path: join(root, `.benchmarks/dsh-${mode}.png`) })
    phase = 'dock'
    await (betterSidebar ? verifyBetterSidebar : verifyDock)({ page, frame, iframe, context, root, mode, readMain, probeRequest, expect, external, menu })
    phase = 'session-following'
    await verifySessionFollowing({ page, frame, home, probeRequest, readMain, external, expect })
    if (betterSidebar) await expectPersistedDocumentTab({ page, sessionId, expect })
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
    // A precheck followed by a toggle can close the tab while restoration completes.
    if (betterSidebar) await expect(launcher).toHaveAttribute('aria-expanded', 'true')
    else await launcher.click()
    await expect.poll(readMain).toBe(external)
    await expect(frame.locator('.typst-doc')).toBeVisible()
    await expect(frame.locator('.web-document-title')).toHaveText('project')
    assert.deepEqual(errors, [])
    await expect.poll(async () => (await probeRequest({ action: 'catalog' })).filter((tool) => tool.name === 'tylina').length).toBe(1)
    const instructions = await probeRequest({ action: 'instructions' })
    assert.deepEqual([...instructions.pending, ...instructions.recorded], [],
      'opening and reconnecting the editor must not append Tylina instructions or connection notices')
    assert.equal(instructions.status, 'idle', 'opening a document does not start an inference task')
    for (const marker of ['Agent loop verified.', 'Continued after compaction.']) {
      if (marker.startsWith('Continued')) await probeRequest({ action: 'compact' })
      const beforeTurn = await readMain()
      await probeRequest({ action: 'turn', marker })
      await expect.poll(async () => {
        const state = await probeRequest({ action: 'model' })
        if (state.error) throw new Error(state.error)
        return state.complete && state.status === 'idle'
      }, { timeout: 60_000 }).toBe(true)
      const state = await probeRequest({ action: 'model' })
      assert.equal(state.requests.length, 7)
      await expect.poll(readMain).toBe(beforeTurn.replace('External Harness edit', `External Harness edit\r\n${marker}`))
      const pdf = await readFile(join(project, 'output/Agent.pdf'))
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
    }
    await page.reload()
    const historySetup = page.getByRole('button', { name: /^(稍后配置|Set up later|Configure later)$/u })
    const historyLauncher = page.getByRole('button', { name: /^(打开 Tylina|Open Tylina)$/u })
    await expect.poll(async () => await historySetup.isVisible() || await historyLauncher.isVisible()).toBe(true)
    if (await historySetup.isVisible()) await historySetup.click()
    const latestToolGroup = page.getByRole('button', { name: /(?:tool calls|工具调用)/iu }).last()
    await expect(latestToolGroup).toBeVisible()
    await latestToolGroup.click()
    const validationCard = page.locator('.tylina-tool-card').filter({ hasText: 'document.validate' }).last()
    await expect(validationCard).toBeVisible()
    await validationCard.locator('summary').click()
    await expect(validationCard).toContainText(/(?:Document (?:is )?valid|Compilation succeeded: .+\.typ\.)/u)
    assert.ok(!(await validationCard.innerText()).includes('"valid"'),
      'the DSH card must present validation prose rather than canonical JSON')
    const imageCard = page.locator('.tylina-tool-card').filter({ hasText: 'render.page' }).last()
    await expect(imageCard).toBeVisible()
    await imageCard.locator('summary').click()
    await expect(imageCard).toContainText(/(?:Images returned: 1|返回图片：1 张)/u)
    assert.ok(!(await imageCard.innerText()).includes('attachmentId'),
      'the DSH card must summarize image receipts rather than printing attachment JSON')
    assert.equal(
      await page.locator('.tylina-tool-card').evaluateAll((cards) =>
        cards.every((card) => card.closest('[data-turn-process-member="true"]') !== null)),
      true,
      'historical Tylina calls must remain members of the Agent process disclosure after reload'
    )
    await page.screenshot({ path: join(root, `.benchmarks/dsh-${mode}-tool-cards${betterSidebar ? '-better-sidebar' : ''}.png`) })
    if (betterSidebar) await expect(historyLauncher).toHaveAttribute('aria-expanded', 'true')
    else await historyLauncher.click()
    await expect(frame.locator('.typst-doc')).toBeVisible({ timeout: 30_000 })
    if (env.TYLINA_DSH_LIVE_KEY) await verifyLiveModel({ page, frame, project, readMain, probeRequest, expect, errors, expectedMissing })
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
    console.log(`PASS ${mode} on DSH ${dshVersion}${betterSidebar ? ` with Better Sidebar ${betterSidebarVersion}` : ''}: ` +
      'packed install, Agent loop, eval/import, PDF/PNG/SVG/PPTX export, ' +
      'disk saves, external Undo, image receipts, navigation, reload and disposal')
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
    await writeFile(join(home, 'server.log'), output.replace(/\?token=\S+/gu, '?token=[redacted]')
      .replaceAll(env.TYLINA_DSH_LIVE_KEY || '__no_live_credential__', '[redacted]'))
    await writeFile(join(home, 'browser-diagnostics.json'), (JSON.stringify({ errors, diagnostics }, null, 2) + '\n')
      .replaceAll(env.TYLINA_DSH_LIVE_KEY || '__no_live_credential__', '[redacted]'))
  }
}

function createPdf(text) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let source = '%PDF-1.4\n'
  const offsets = []
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source))
    source += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(source)
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  source += offsets
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
  return Buffer.from(`${source}startxref\n${xref}\n%%EOF\n`)
}
