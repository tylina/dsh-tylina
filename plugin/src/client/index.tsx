import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { IconFolder, IconRefresh, IconMessageCircle, IconExternalLink, IconX } from '@tabler/icons-react'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { openHarnessDocument, prepareHarnessProject, type HarnessDocument } from './document'
import { css } from './styles'
import { ProjectPicker } from './project-picker'
import { BetterSidebarIntegration, registerBetterSidebar } from './better-sidebar'
import { TylinaBrand, WebEditorLink } from './brand'

import { en, zh } from './locale'
import { DockResize, useDocumentDock } from './dock'
import { createProjectWindow, type ProjectWindow } from './popout'
import { attachProjectLauncher, type ProjectLauncherOptions } from './window-launcher'
import { readProjectWindow } from './window-record'
import { ensureHarnessWorkspace } from './workspace'
import { McpConnectionButton } from './mcp-connection'
import { useToolReconnect } from './use-tool-reconnect'

type Props = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'tylina'> & { ctx: Context; integration: BetterSidebarIntegration }
interface Project { sessionId: SessionId; project: string; entry?: string }

function EditorAction({ ctx, wide, t, integration }: Props) {
  const launcher = useRef<HTMLButtonElement>(null), hideButton = useRef<HTMLButtonElement>(null)
  const container = useRef<HTMLDivElement>(null), floating = useRef<ProjectWindow | undefined>(undefined)
  const [visible, setVisible] = useState(false)
  const sidebar = useSyncExternalStore(integration.subscribe, integration.getSnapshot)
  integration.title = () => t('title')
  integration.openLabel = () => t('open')
  const currentDocument = useRef<HarnessDocument | undefined>(undefined)
  const alive = useRef(true), opening = useRef(false)
  const sessions = useSyncExternalStore(ctx.sessions.list.subscribe, ctx.sessions.list.getSnapshot)
  const shown = sidebar.embedded ? sidebar.visible : visible && (!sidebar.available || !sessions.ids.length)
  const dock = useDocumentDock(shown && !sidebar.embedded)
  useEffect(() => { if (sidebar.embedded) setVisible(sidebar.visible) }, [sidebar.embedded, sidebar.visible])
  const [selection, setSelection] = useState<Project | undefined>()
  const [selectedId, setSelectedId] = useState<SessionId | ''>('')
  const [project, setProject] = useState('')
  useEffect(() => { if (!selection && sidebar.sessionId) setSelectedId(sidebar.sessionId as SessionId) }, [selection, sidebar.sessionId])
  const [changing, setChanging] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const followedSession = useRef<SessionId | null>(null)
  useEffect(() => { alive.current = true; return () => { alive.current = false; currentDocument.current?.dispose(); floating.current?.dispose() } }, [])
  const report = (error: Error) => { if (alive.current) setError(error.message) }
  const toolConnection = useToolReconnect(() => currentDocument.current, report)
  const show = () => {
    if (floating.current) { try { floating.current.focus() } catch (error) { report(error as Error) } return }
    void ctx.sessions.refresh().catch(report)
    if (!selection) setSelectedId(sessions.current ?? sessions.ids[0] ?? '')
    setVisible(true)
    if (sidebar.available) {
      const id = sessions.current ?? sessions.ids[0]
      if (id) { ctx.sessions.open(id); integration.open(id) }
    }
    requestAnimationFrame(() => hideButton.current?.focus())
  }
  const hide = () => { integration.hide(); setVisible(false); requestAnimationFrame(() => launcher.current?.focus()) }
  const focusChat = (id: SessionId) => { ctx.sessions.open(id); if (window.innerWidth < 900) hide() }
  const open = async (next: Project = { sessionId: selectedId as SessionId, project: project.trim() }, selectConversation = true) => {
    if (opening.current || !container.current || !next.sessionId || !ctx.sessions.list.getSnapshot().byId[next.sessionId]) return new Error(t('noSession'))
    opening.current = true; setBusy(true); setError(undefined)
    try {
      if (currentDocument.current && !await currentDocument.current.editor.save()) throw new Error(t('saveFailed'))
      await ensureHarnessWorkspace(ctx, next.sessionId)
      const prepared = await prepareHarnessProject(next)
      if (!alive.current) return
      currentDocument.current?.dispose(); currentDocument.current = undefined; setSelection(undefined)
      const editor = await openHarnessDocument(container.current, { ...next, prepared, onError: report,
        onOpenAgent() {
          if (!alive.current || !ctx.sessions.list.getSnapshot().byId[next.sessionId]) throw new Error(t('noSession'))
          focusChat(next.sessionId)
        }
      })
      if (!alive.current) { editor.dispose(); return }
      currentDocument.current = editor; setSelection(next); setChanging(false)
      if (selectConversation) ctx.sessions.open(next.sessionId)
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      report(failure); return failure
    }
    finally { opening.current = false; if (alive.current) setBusy(false) }
  }
  integration.onFileOpen = (sessionId, entry) => {
    const id = sessionId as SessionId
    if (floating.current) { floating.current.focus(); return }
    ctx.sessions.open(id); integration.open(id); setVisible(true)
    void open({ sessionId: id, project: '', entry }, false)
  }
  useEffect(() => {
    const id = (sidebar.sessionId as SessionId | undefined) ?? sessions.current
    if (!selection || !id || busy || changing || floating.current) return
    if (id === selection.sessionId) { followedSession.current = null; return }
    if (followedSession.current === id) return
    followedSession.current = id
    setSelectedId(id); setProject(''); setChanging(true)
    void open({ sessionId: id, project: '' }, false)
  }, [sessions.current, sidebar.sessionId, selection, busy, changing])
  const launcherOptions: ProjectLauncherOptions = { t, onError: report,
    async restore(project) {
      await ctx.sessions.refresh()
      if (!alive.current) throw new Error(t('disconnected'))
      setVisible(true); setChanging(true)
      const error = await open({ ...project, sessionId: project.sessionId as SessionId })
      if (error) { setVisible(false); throw error }
      floating.current = undefined
      if (sidebar.available) integration.open(project.sessionId)
    },
    async chat(project) {
      await ctx.sessions.refresh()
      if (!alive.current || !ctx.sessions.list.getSnapshot().byId[project.sessionId as SessionId]) throw new Error(t('noSession'))
      focusChat(project.sessionId as SessionId)
    }
  }
  const latestLauncherOptions = useRef(launcherOptions)
  latestLauncherOptions.current = launcherOptions
  useEffect(() => {
    const record = readProjectWindow()
    if (record) floating.current = attachProjectLauncher(record, { t,
      restore: (project) => latestLauncherOptions.current.restore(project),
      chat: (project) => latestLauncherOptions.current.chat(project), onError: report })
  }, [])
  const popout = () => {
    if (!selection || busy || floating.current) return
    const bound = selection
    try {
      floating.current = createProjectWindow({ ...launcherOptions, project: bound,
        async release(remember) {
          setBusy(true)
          try {
            if (!await currentDocument.current?.editor.save()) throw new Error(t('saveFailed'))
            remember()
            currentDocument.current?.dispose(); currentDocument.current = undefined
            integration.hide(); setVisible(false)
          } catch (error) { floating.current = undefined; report(error as Error); throw error }
          finally { if (alive.current) setBusy(false) }
        }
      })
    } catch (error) { report(error as Error) }
  }
  return <>
    <button ref={launcher} type="button" className="tylina-dsh-open" title={t('open')} aria-label={t('open')}
      aria-expanded={shown} aria-controls="tylina-dsh-editor-panel" onClick={() => shown ? hide() : show()}>
      <img src="/tylina/favicon.svg" width="20" height="20" alt="" />{wide && <span>{t('title')}</span>}
    </button>
    {createPortal(<aside id="tylina-dsh-editor-panel" className={`tylina-dsh-panel${sidebar.embedded ? ' tylina-dsh-panel-embedded' : ''}`} aria-label={t('title')} hidden={!shown}
      role={dock.narrow && !sidebar.embedded ? 'dialog' : 'complementary'} aria-modal={!sidebar.embedded && dock.narrow || undefined}
      style={{ width: sidebar.embedded ? '100%' : dock.width }} onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); hide() }
      }}>
      {!sidebar.embedded && !dock.narrow && <DockResize width={dock.width} update={dock.update} label={t('resize')} />}
      <div className="tylina-dsh-bar">
        {!sidebar.embedded && <TylinaBrand t={t} />}
        <span className="tylina-dsh-session" title={selection && sessions.byId[selection.sessionId]?.cwd}>
          {!sidebar.embedded && selection && (sessions.byId[selection.sessionId]?.displayTitle ?? selection.sessionId)}
        </span>
        {selection && <>
          <McpConnectionButton getDocument={() => currentDocument.current} t={t} disabled={busy || changing || toolConnection.busy} />
          <button type="button" title={t('change')} aria-label={t('change')} disabled={busy}
            onClick={() => {
              void ctx.sessions.refresh().catch(report)
              setSelectedId(selection.sessionId); setProject(selection.project); setChanging(true)
            }}><IconFolder size={16} /></button>
          <button type="button" title={t(toolConnection.busy ? 'reconnecting' : 'retry')}
            aria-label={t(toolConnection.busy ? 'reconnecting' : 'retry')} aria-busy={toolConnection.busy}
            disabled={busy || toolConnection.busy} onClick={toolConnection.reconnect}><IconRefresh size={16} /></button>
          <button type="button" title={t('chat')} aria-label={t('chat')}
            onClick={() => focusChat(selection.sessionId)}><IconMessageCircle size={16} /></button>
        </>}
        <WebEditorLink t={t} />
        {selection && <button type="button" title={t('popout')} aria-label={t('popout')} disabled={busy || changing}
          onClick={popout}><IconExternalLink size={16} /></button>}
        <button ref={hideButton} type="button" onClick={hide} title={t('close')} aria-label={t('close')}><IconX size={16} /></button>
      </div>
      {error && <div className="tylina-dsh-error" role="alert"><span>{error}</span>
        <button type="button" aria-label={t('dismiss')} onClick={() => setError(undefined)}><IconX size={16} /></button></div>}
      {changing && <ProjectPicker key={selection?.sessionId ?? 'initial'} t={t}
        sessions={sessions.ids.map((id) => ({ id, title: sessions.byId[id]?.displayTitle ?? id, cwd: sessions.byId[id]?.cwd }))}
        selectedId={selectedId} project={project} busy={busy} canCancel={Boolean(selection)}
        onSelect={(id) => setSelectedId(id as SessionId)} onProject={setProject}
        onOpen={() => { void open() }} onCancel={() => setChanging(false)}
        onCreate={() => { void ctx.sessions.create({}).then((id) => { setSelectedId(id); ctx.sessions.open(id); if (sidebar.available) integration.open(id) }).catch(report) }} />}
      <div ref={container} className="tylina-dsh-editor" hidden={changing} />
    </aside>, integration.surface)}
  </>
}

export const inject = ['slots', 'locale', 'sessions', 'workspaces']
export function apply(ctx: Context): void {
  const integration = new BetterSidebarIntegration()
  ctx.effect(() => () => integration.dispose())
  registerBetterSidebar(ctx, integration)
  ctx.effect(() => ctx.locale.register('tylina', { en, zh }))
  ctx.effect(() => {
    const style = document.createElement('style'); style.textContent = css
    document.head.append(style); return () => style.remove()
  })
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
    { name: 'sidebar.footer.action', id: 'tylina', locale: 'tylina' }, (props) => <EditorAction {...props} ctx={ctx} integration={integration} />
  ))
}
