import { createTylinaEditor, type TylinaEditor } from 'tylina-sdk/client'
import { createWebSocketRuntime } from 'tylina-sdk/client'
import { connectHarnessEditor } from './editor-connection'
import { decodeWorkspace, encodeWorkspace, type ProjectSnapshot } from '../workspace-wire'

export interface HarnessDocument {
  editor: TylinaEditor; reconnectTools(): Promise<void>
  mcpConfiguration(): ReturnType<ReturnType<typeof connectHarnessEditor>['mcpConfiguration']>
  dispose(): void
}
interface PreparedProject { url: URL; initial: ProjectSnapshot; preferenceKey: string }

function socketUrl(path: string): URL {
  const url = new URL(path, location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url
}

async function projectRequest(url: URL, init: RequestInit): Promise<Response> {
  const response = await fetch(url, { ...init, credentials: 'same-origin', redirect: 'error', cache: 'no-store' })
  if (!response.ok && response.status !== 304) {
    const result = await response.json().catch(() => null)
    throw new Error(typeof result?.error === 'string' ? result.error : `Harness project request failed (${response.status})`)
  }
  return response
}

export async function prepareHarnessProject(options: { sessionId: string; project: string; entry?: string }): Promise<PreparedProject> {
  const url = new URL('/tylina/project', location.href)
  url.searchParams.set('session', options.sessionId)
  if (options.project) url.searchParams.set('project', options.project)
  const preferenceKey = `tylina.dsh.project.${JSON.stringify([options.sessionId, options.project])}`
  try {
    const preference = JSON.parse(localStorage.getItem(preferenceKey) ?? 'null')
    if (typeof preference?.mainFile === 'string') url.searchParams.set('main', preference.mainFile)
    if (typeof preference?.activeFile === 'string') url.searchParams.set('file', preference.activeFile)
  } catch { /* Navigation preferences are optional, not document storage. */ }
  if (options.entry) url.searchParams.set('entry', options.entry)
  const initial = await (await projectRequest(url, {})).json() as ProjectSnapshot
  url.searchParams.delete('entry')
  if (initial.workspace.mainFile) url.searchParams.set('main', initial.workspace.mainFile)
  if (initial.workspace.activeFile) url.searchParams.set('file', initial.workspace.activeFile)
  return { url, initial, preferenceKey }
}

export async function openHarnessDocument(container: HTMLElement, options: {
  sessionId: string; project: string; prepared: PreparedProject; onError(error: Error): void; onOpenAgent(): void | Promise<void>
}): Promise<HarnessDocument> {
  const lifetime = new AbortController()
  const { url, initial, preferenceKey } = options.prepared
  let revision = initial.revision
  let tools: ReturnType<typeof connectHarnessEditor> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let closed = false
  let reconnecting: Promise<void> | undefined
  const editor = await createTylinaEditor(container, {
    editorUrl: new URL('/tylina/embed.html', location.href), workspace: decodeWorkspace(initial.workspace),
    workspaceRevision: revision, tools: true, onError: options.onError, onOpenAgent: options.onOpenAgent,
    createRuntime: initial.mode === 'native' ? () => createWebSocketRuntime(socketUrl('/tylina/runtime'), options.onError) : undefined,
    async onSave(workspace, context) {
      const response = await projectRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace: encodeWorkspace(workspace), revision: context.revision }),
        signal: AbortSignal.any([context.signal, lifetime.signal]) })
      const acknowledgment = await response.json() as { revision: string }
      revision = acknowledgment.revision
      if (workspace.mainFile) url.searchParams.set('main', workspace.mainFile); else url.searchParams.delete('main')
      if (workspace.activeFile) url.searchParams.set('file', workspace.activeFile); else url.searchParams.delete('file')
      try { localStorage.setItem(preferenceKey, JSON.stringify({ mainFile: workspace.mainFile, activeFile: workspace.activeFile })) }
      catch { /* Saving actual project bytes does not depend on optional navigation preferences. */ }
      return acknowledgment
    }
  })
  const refresh = async () => {
    const expectedRevision = revision
    try {
      const response = await projectRequest(url, { headers: { 'If-None-Match': `"${expectedRevision}"` }, signal: lifetime.signal })
      if (closed || response.status === 304 || revision !== expectedRevision) return
      const next = await response.json() as ProjectSnapshot
      if (closed || revision !== expectedRevision) return
      await editor.refreshWorkspace(decodeWorkspace(next.workspace), { expectedRevision, revision: next.revision })
      if (revision === expectedRevision) revision = next.revision
    } catch (error) {
      if (!closed && revision === expectedRevision) options.onError(error instanceof Error ? error : new Error(String(error)))
    } finally { if (!closed) timer = setTimeout(() => { void refresh() }, 1000) }
  }
  const reconnectTools = (): Promise<void> => {
    if (closed) return Promise.reject(new Error('The Harness document is closed'))
    return reconnecting ??= (async () => {
      await tools?.release()
      if (closed) throw new Error('The Harness document is closed')
      tools = connectHarnessEditor({ url: socketUrl('/tylina/editor'), sessionId: options.sessionId, project: options.project,
        editor, onDisconnect: options.onError })
      await tools.ready
    })().finally(() => { reconnecting = undefined })
  }
  const dispose = () => {
    if (closed) return
    closed = true; clearTimeout(timer); lifetime.abort(); tools?.dispose(); editor.dispose()
  }
  // A tools connection failure preserves the editable project and its unsaved input.
  void reconnectTools().catch(options.onError)
  timer = setTimeout(() => { void refresh() }, 1000)
  return { editor, reconnectTools, dispose, mcpConfiguration() {
    if (!tools) throw new Error('The document tools are not connected')
    return tools.mcpConfiguration()
  } }
}
