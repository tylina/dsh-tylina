import type { Translate } from './locale'
import { forgetProjectWindow, launcherChannel, projectWindowName, type ProjectSelection, type ProjectWindowRecord } from './window-record'

export interface ProjectWindow { focus(): void; dispose(): void }
export interface ProjectLauncherOptions {
  t: Translate
  restore(project: ProjectSelection): Promise<void>
  chat(project: ProjectSelection): Promise<void>
  onError(error: Error): void
}

/** Reattach to a detached window after reload without creating a second editor or tool owner. */
export function attachProjectLauncher(record: ProjectWindowRecord, options: ProjectLauncherOptions,
  initial?: Window, initiallyActive = true): ProjectWindow & { activate(): void } {
  let popup = initial, active = initiallyActive, disposed = false, restoring: Promise<void> | undefined
  let closedAttempt: Window | undefined
  const requests = new Map<string, Promise<void>>()
  const channel = launcherChannel(record)
  const dispose = () => {
    if (disposed) return
    disposed = true; clearInterval(timer); channel.close(); window.removeEventListener('message', message)
  }
  const restore = () => restoring ??= options.restore(record.project).catch((error) => {
    restoring = undefined; throw error
  })
  const message = (event: MessageEvent) => {
    const source = event.source
    if (disposed || !active || event.origin !== location.origin || !source || !('closed' in source) ||
      event.data?.token !== record.token || (popup && popup !== source) ||
      typeof event.data.request !== 'string' || event.data.request.length > 64 ||
      !['tylina/canDock', 'tylina/dock', 'tylina/chat'].includes(event.data.kind)) return
    popup = source as Window
    const { kind, request } = event.data
    if (requests.has(request) || requests.size >= 64) return
    const reply = (error?: unknown) => {
      if (disposed) return
      popup?.postMessage({ kind: kind === 'tylina/dock' ? 'tylina/docked' : kind, token: record.token, request,
        ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}) }, location.origin)
    }
    const task = (async () => {
      if (kind === 'tylina/dock') {
        await restore()
        if (!disposed) { reply(); forgetProjectWindow(record); dispose() }
      } else {
        if (kind === 'tylina/chat') { await options.chat(record.project); window.focus() }
        reply()
      }
    })().catch(reply)
    requests.set(request, task)
    // Only idempotent readiness probes are retried while the Harness page is starting.
    void task.finally(() => requests.delete(request))
  }
  window.addEventListener('message', message)
  const timer = setInterval(() => {
    if (!active || disposed || !popup?.closed || restoring || closedAttempt === popup) return
    closedAttempt = popup
    void restore().then(() => {
      if (!disposed) { forgetProjectWindow(record); dispose() }
    }).catch(options.onError)
  }, 400)
  const announce = () => {
    channel.postMessage('ready')
    if (window.opener && !window.opener.closed) window.opener.postMessage({ kind: 'tylina/launcher', token: record.token }, location.origin)
  }
  channel.onmessage = ({ data }) => { if (data === 'document-ready') announce() }
  announce()
  return { dispose, activate() { active = true }, focus() {
    if (popup && !popup.closed) { popup.focus(); return }
    const target = window.open('', projectWindowName(record), 'popup,width=1200,height=900')
    if (!target) throw new Error(options.t('blocked'))
    popup = target
    if (target.location.href === 'about:blank') {
      const url = new URL('/tylina/project-window.html', location.href)
      url.searchParams.set('session', record.project.sessionId); url.searchParams.set('project', record.project.project)
      url.searchParams.set('bridge', record.token); url.searchParams.set('locale', options.t('open') === 'Open Tylina' ? 'en' : 'zh')
      target.location.replace(url.href)
    }
    target.focus()
  } }
}
