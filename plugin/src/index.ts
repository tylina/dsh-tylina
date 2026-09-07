import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { LspProcessOptions } from '@tylina/node-runtime/lsp-transport'
import { createAssetHandler } from './assets'
import { createRuntimeSocket } from './socket'
import { registerTylinaSkills } from './skills'
import { createHarnessWorkspaces } from './workspaces'
import { createEditorSocket } from './editor-socket'
import { createSessionBinder } from './session-binding'
import { createHarnessToolRuntime } from './tool-runtime'
import { createHarnessMcpEndpoints } from './mcp'
import { version } from '../package.json'

export interface Config {
  mode?: 'wasm' | 'native'
  sidecar?: LspProcessOptions
  languageServer?: LspProcessOptions
}
export const inject = ['webServer', 'connection', 'skills', 'sessionController', 'tools', 'attachments', 'fs']

export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const mode = config.mode ?? 'wasm'
  if (mode !== 'wasm' && mode !== 'native') throw new Error('Tylina runtime must be wasm or native')
  if (mode === 'native' && (!config.sidecar || !config.languageServer)) throw new Error('The native bundle must supply both Tinymist executables')
  registerTylinaSkills(ctx, fileURLToPath(new URL('./skills/', import.meta.url)))
  const assets = await createAssetHandler(fileURLToPath(new URL('./web/', import.meta.url)), {
    mode, ...(mode === 'native' ? { endpoint: '/tylina/runtime' } : {})
  })
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/tylina', async handler(request, response) {
    const rejection = ctx.connection.requestRejection(request)
    if (rejection !== undefined) { response.writeHead(rejection); response.end(); return }
    try { await assets(request, response) }
    catch { if (!response.headersSent) response.writeHead(400); response.end() }
  } }))
  ctx.effect(() => {
    const workspaces = createHarnessWorkspaces(ctx, mode)
    const toolRuntime = createHarnessToolRuntime()
    const mcp = createHarnessMcpEndpoints({ version, requestRejection: (request) => ctx.connection.requestRejection(request) })
    const editors = createEditorSocket({ authorize: (request) => ctx.connection.requestRejection(request),
      bind: createSessionBinder(workspaces, fileURLToPath(new URL('./skills/', import.meta.url)), toolRuntime, mcp) })
    const unregisterMcp = ctx.webServer.register({ kind: 'prefix', path: '/tylina/mcp', handler: mcp.handle })
    const unregisterProjects = ctx.webServer.register({ kind: 'exact', path: '/tylina/project', async handler(request, response) {
      const rejection = ctx.connection.requestRejection(request)
      if (rejection !== undefined) { response.writeHead(rejection); response.end(); return }
      await workspaces.handle(request, response)
    } })
    const unregisterEditor = ctx.webServer.registerUpgrade({ path: '/tylina/editor', handler: editors.upgrade })
    return async () => { unregisterProjects(); unregisterEditor(); unregisterMcp();
      await editors.dispose(); await mcp.dispose(); await toolRuntime.dispose(); await workspaces.dispose() }
  })
  if (mode === 'native') {
    ctx.effect(() => {
      const runtime = createRuntimeSocket({ authorize: (request) => ctx.connection.requestRejection(request), sidecar: config.sidecar!, languageServer: config.languageServer! })
      const unregister = ctx.webServer.registerUpgrade({ path: '/tylina/runtime', handler: runtime.upgrade })
      return () => { unregister(); runtime.dispose() }
    })
  }
}
