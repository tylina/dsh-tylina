import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { IconLayoutSidebarRight, IconMessageCircle, IconRefresh, IconX } from '@tabler/icons-react'
import { openHarnessDocument, prepareHarnessProject, type HarnessDocument } from './document'
import { en, zh } from './locale'
import { css } from './styles'
import { TylinaBrand, WebEditorLink } from './brand'
import { McpConnectionButton } from './mcp-connection'
import { createProjectContact } from './window-contact'
import { useToolReconnect } from './use-tool-reconnect'

const params = new URL(location.href).searchParams
const strings = params.get('locale') === 'zh' ? zh : en
const t = (key: keyof typeof en) => strings[key]
const record = { token: params.get('bridge') ?? crypto.randomUUID(),
  project: { sessionId: params.get('session') ?? '', project: params.get('project') ?? '' } }
if (!params.has('bridge')) {
  const url = new URL(location.href); url.searchParams.set('bridge', record.token); history.replaceState(history.state, '', url)
}
const bridge = createProjectContact(record, t)
const contact = bridge.contact
window.addEventListener('pagehide', () => bridge.dispose(), { once: true })

function ProjectWindow() {
  const container = useRef<HTMLDivElement>(null), current = useRef<HarnessDocument>()
  const [error, setError] = useState<string>(), [busy, setBusy] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const report = (error: unknown) => setError(error instanceof Error ? error.message : String(error))
  const toolConnection = useToolReconnect(() => current.current, report)
  useEffect(() => {
    let alive = true
    const abort = new AbortController()
    const open = async () => {
      const project = { sessionId: params.get('session') ?? '', project: params.get('project') ?? '' }
      if (!project.sessionId) throw new Error(t('noSession'))
      const prepared = await prepareHarnessProject({ ...project, signal: abort.signal })
      if (!alive) { prepared.dispose(); return }
      const doc = await openHarnessDocument(container.current!, { ...project, prepared, signal: abort.signal,
        onError: (error) => { if (alive) report(error) }, onOpenAgent: () => contact('chat') })
      if (!alive) { doc.dispose(); return }
      current.current = doc
    }
    setBusy(true); setError(undefined)
    void open().catch((error) => { if (alive) report(error) }).finally(() => { if (alive) setBusy(false) })
    const dispose = () => { alive = false; abort.abort(); current.current?.dispose(); current.current = undefined }
    window.addEventListener('pagehide', dispose, { once: true })
    return () => { window.removeEventListener('pagehide', dispose); dispose() }
  }, [attempt])
  const dock = async () => {
    if (busy) return
    setBusy(true); setError(undefined)
    try {
      await contact('canDock')
      if (current.current && !await current.current.editor.save()) throw new Error(t('saveFailed'))
      current.current?.dispose(); current.current = undefined
      await contact('dock')
      window.close()
    } catch (error) {
      report(error)
      // If the original tab disappeared during handoff, reopen this project's saved canonical state here.
      if (!current.current) setAttempt((value) => value + 1)
    } finally { setBusy(false) }
  }
  return <main className="tylina-dsh-panel" style={{ width: '100%', border: 0 }}>
    <header className="tylina-dsh-bar"><TylinaBrand t={t} /><span className="tylina-dsh-session">{params.get('project')}</span><WebEditorLink t={t} />
      <McpConnectionButton getDocument={() => current.current} t={t} disabled={busy || toolConnection.busy} />
      <button type="button" title={t(toolConnection.busy ? 'reconnecting' : 'retry')}
        aria-label={t(toolConnection.busy ? 'reconnecting' : 'retry')} aria-busy={toolConnection.busy}
        disabled={busy || toolConnection.busy} onClick={() => {
        if (current.current) toolConnection.reconnect()
        else setAttempt((value) => value + 1)
      }}><IconRefresh size={16} /></button>
      <button type="button" title={t('chat')} aria-label={t('chat')} onClick={() => { void contact('chat').catch(report) }}><IconMessageCircle size={16} /></button>
      <button type="button" title={t('dock')} aria-label={t('dock')} disabled={busy} onClick={() => { void dock() }}><IconLayoutSidebarRight size={16} /></button>
    </header>
    {error && <div className="tylina-dsh-error" role="alert"><span>{error}</span>
      <button type="button" aria-label={t('dismiss')} onClick={() => setError(undefined)}><IconX size={16} /></button></div>}
    {busy && !current.current && <p style={{ padding: 16, fontSize: 13 }}>{t('loading')}</p>}
    <div ref={container} className="tylina-dsh-editor" />
  </main>
}
const style = document.createElement('style')
style.textContent = css + `body { margin:0; font-family:system-ui,sans-serif; }
@media(prefers-color-scheme:dark) { body { --dsw-alias-bg-base:#1f2023; --dsw-alias-label-primary:#eee;
 --dsw-alias-border-l2:#383b42; --dsw-alias-bg-overlay:#2b2d32; } }`
document.head.append(style)
document.documentElement.lang = params.get('locale') === 'zh' ? 'zh-CN' : 'en'
createRoot(document.getElementById('root')!).render(<ProjectWindow />)
