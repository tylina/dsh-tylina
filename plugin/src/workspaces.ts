import { realpath } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { checkWorkspacePath, createNodeWorkspacePool, nativeWorkspacePath, requireWorkspaceRelativePath } from 'tylina-sdk/node'
import { decodeWorkspace, encodeWorkspace, type WorkspaceWire } from './workspace-wire'
import { withAgentServices } from './agent-services'

/** A provider-owned process path is usable by Node only with an explicit identity host mapping. */
export async function resolveHarnessProject(fs: FileSystem, cwd: string, project: string, signal?: AbortSignal): Promise<string> {
  if (!cwd) throw new Error('This Harness session has no working directory')
  const owner = await fs.resolve(cwd, { signal })
  const processPath = fs.processPath(owner)
  if (!isAbsolute(processPath) || fs.processPathFromHostPath(processPath) !== processPath) {
    throw new Error('This Harness filesystem does not expose a shared host directory for the editor')
  }
  const root = await realpath(processPath)
  if (fs.processPathFromHostPath(root) !== processPath) throw new Error('The Harness directory is not an identity host mapping')
  const path = project ? nativeWorkspacePath(root, requireWorkspaceRelativePath(project)) : root
  await checkWorkspacePath(root, project || undefined)
  const target = await fs.resolve(path, { signal })
  if (!fs.contains(owner, target) || fs.processPath(target) !== path || fs.processPathFromHostPath(path) !== path ||
    (await fs.stat(target, signal))?.type !== 'directory') throw new Error('Choose a directory inside this Harness session')
  signal?.throwIfAborted()
  return path
}

export function createHarnessWorkspaces(ctx: Context, mode: 'wasm' | 'native') {
  const pool = createNodeWorkspacePool()
  const resolve = async (sessionId: string, project: string, signal?: AbortSignal) => {
    if (!sessionId || sessionId.length > 256 || project.length > 2048) throw new Error('Invalid Harness project identity')
    const result = await ctx.sessionController.resolveAgent(SessionId(sessionId))
    if ('error' in result) throw new Error(result.error.message)
    signal?.throwIfAborted()
    const { agent } = result
    const path = await withAgentServices(agent, ['fs'], (context) =>
      resolveHarnessProject(context.fs, agent.session.header.cwd ?? '', project, signal))
    return { store: await pool.get(path), agent }
  }
  return {
    resolve,
    dispose: pool.dispose,
    async handle(request: IncomingMessage, response: ServerResponse) {
      const abort = new AbortController()
      const disconnect = () => { if (!response.writableFinished) abort.abort(new Error('The project request disconnected')) }
      response.on('close', disconnect)
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader('X-Content-Type-Options', 'nosniff')
      try {
        if (request.method !== 'GET' && request.method !== 'POST') { response.writeHead(405, { Allow: 'GET, POST' }); response.end(); return }
        if (request.method === 'POST' && (!request.headers.origin || request.headers['content-type'] !== 'application/json')) {
          response.writeHead(403); response.end(); return
        }
        const url = new URL(request.url ?? '/', 'http://localhost')
        const { store } = await resolve(url.searchParams.get('session') ?? '', url.searchParams.get('project') ?? '', abort.signal)
        let result: unknown
        if (request.method === 'GET') {
          const snapshot = await store.readIfChanged(request.headers['if-none-match'], { mainFile: url.searchParams.get('main'), activeFile: url.searchParams.get('file') })
          if (!snapshot) { response.writeHead(304); response.end(); return }
          response.setHeader('ETag', `"${snapshot.revision}"`)
          result = { ...snapshot, mode, workspace: encodeWorkspace(snapshot.workspace) }
        } else {
          const chunks: Buffer[] = []
          let bytes = 0
          for await (const chunk of request) {
            bytes += chunk.length
            if (bytes > 192 * 1024 * 1024) throw new Error('Project request exceeds its byte limit')
            chunks.push(Buffer.from(chunk))
          }
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { workspace: WorkspaceWire; revision: string }
          if (typeof body.revision !== 'string' || body.revision.length > 256) throw new Error('Invalid project revision')
          result = await store.save(decodeWorkspace(body.workspace), body.revision, abort.signal)
        }
        response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result))
      } catch (error) {
        if (!response.headersSent) response.writeHead(error instanceof Error && error.name === 'WorkspaceVersionConflict' ? 409 : 400, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Could not access the Harness project' }))
      } finally { response.off('close', disconnect) }
    }
  }
}
