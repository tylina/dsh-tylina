import type { Translate } from './locale'
import { launcherChannel, rememberProjectWindow, type ProjectWindowRecord } from './window-record'

/** The document keeps running; a closed launcher can be replaced only by an explicit user action. */
export function createProjectContact(record: ProjectWindowRecord, t: Translate) {
  let parent: Window | null = window.opener
  const lifetime = new AbortController(), channel = launcherChannel(record)
  const prepare = () => {
    if (parent && !parent.closed) return
    const target = window.open('', `tylina-harness-${record.token}`)
    if (!target) throw new Error(t('blocked'))
    parent = target
    // Reusing a named launcher must preserve its conversation draft and navigation state.
    try { if (target.location.href !== 'about:blank') { target.focus(); return } }
    catch { target.focus(); return }
    try {
      rememberProjectWindow(record, target)
      target.location.replace(new URL('/', location.href).href)
    } catch (error) { target.close(); parent = null; throw error }
  }
  const requestContact = (kind: 'canDock' | 'chat' | 'dock', allowOpen = true): Promise<void> => {
    try { if (allowOpen) prepare() } catch (error) { return Promise.reject(error) }
    return new Promise((resolve, reject) => {
      const target = parent
      if (!target || target.closed || lifetime.signal.aborted) { reject(new Error(t('disconnected'))); return }
      const request = crypto.randomUUID(), expected = kind === 'dock' ? 'docked' : kind
      const cleanup = () => {
        clearTimeout(timer); clearInterval(retry); window.removeEventListener('message', message)
        lifetime.signal.removeEventListener('abort', abort)
      }
      const abort = () => { cleanup(); reject(new Error(t('disconnected'))) }
      const message = (event: MessageEvent) => {
        if (event.source !== target || event.origin !== location.origin || event.data?.token !== record.token ||
          event.data.request !== request || event.data.kind !== `tylina/${expected}`) return
        cleanup()
        if (typeof event.data.error === 'string') reject(new Error(event.data.error)); else resolve()
      }
      const send = () => target.postMessage({ kind: `tylina/${kind}`, token: record.token, request }, location.origin)
      const timer = setTimeout(abort, 30_000)
      const retry = kind === 'canDock' ? setInterval(send, 250) : undefined
      window.addEventListener('message', message)
      lifetime.signal.addEventListener('abort', abort, { once: true })
      send()
    })
  }
  const contact = (kind: 'canDock' | 'chat' | 'dock', allowOpen = true): Promise<void> => kind === 'chat'
    ? requestContact('canDock', allowOpen).then(() => requestContact('chat', false)) : requestContact(kind, allowOpen)
  // Discovery only: commands still require the exact launcher WindowProxy, origin and request identity.
  let probing: Promise<void> | undefined
  const online = () => {
    if (parent && !parent.closed && !probing) probing = contact('canDock', false).catch(() => undefined).finally(() => { probing = undefined })
  }
  channel.onmessage = ({ data }) => { if (data === 'ready') online() }
  const discover = (event: MessageEvent) => {
    const source = event.source
    if (parent && !parent.closed || event.origin !== location.origin || event.data?.kind !== 'tylina/launcher' ||
      event.data.token !== record.token || !source || !('opener' in source) || source.opener !== window) return
    parent = source as Window; online()
  }
  window.addEventListener('message', discover)
  window.addEventListener('focus', online)
  channel.postMessage('document-ready')
  online()
  return { contact, dispose() {
    lifetime.abort(); channel.close(); window.removeEventListener('focus', online); window.removeEventListener('message', discover)
  } }
}
