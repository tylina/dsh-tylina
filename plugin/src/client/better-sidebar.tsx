import { useLayoutEffect, useRef } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { BetterSidebarService, TabComponentProps } from 'dsh-better-sidebar/client/service'

const tabType = 'dsh-tylina:document'
interface Mount {
  element: HTMLDivElement
  props: TabComponentProps
}
export interface SidebarSnapshot {
  available: boolean
  embedded: boolean
  visible: boolean
  sessionId?: string
}

/** One persistent portal surface. Tab changes must never reload the editor iframe. */
export class BetterSidebarIntegration {
  readonly surface = document.createElement('div')
  private listeners = new Set<() => void>()
  private snapshot: SidebarSnapshot = { available: false, embedded: false, visible: false }
  private service?: BetterSidebarService
  private mount?: Mount
  private pendingSession?: string
  onFileOpen?: (sessionId: string, path: string) => void
  openLabel = () => 'Open in Tylina'
  title = () => 'Tylina'
  constructor() {
    this.surface.className = 'tylina-dsh-surface'
    document.body.append(this.surface)
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = () => this.snapshot
  private publish(next: SidebarSnapshot) {
    if (Object.keys(next).every((key) => next[key as keyof SidebarSnapshot] === this.snapshot[key as keyof SidebarSnapshot]) &&
      Object.keys(next).length === Object.keys(this.snapshot).length) return
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
  private moveSurface(parent: HTMLElement) {
    if (this.surface.parentElement === parent) return
    // State-preserving DOM moves keep the iframe, its worker, and Undo alive.
    const target = parent as HTMLElement & { moveBefore(node: Node, before: Node | null): void }
    target.moveBefore(this.surface, null)
  }
  private park() {
    this.moveSurface(document.body)
    this.surface.classList.remove('tylina-dsh-surface-embedded')
  }
  private attach(mount: Mount) {
    if (!mount.props.visible) return
    this.mount = mount
    this.moveSurface(mount.element)
    this.surface.classList.add('tylina-dsh-surface-embedded')
    this.publish({ available: true, embedded: true, visible: true, sessionId: mount.props.scope.sessionId })
    return () => {
      if (this.mount !== mount) return
      this.park(); this.mount = undefined
      this.publish({ available: Boolean(this.service), embedded: false, visible: false })
    }
  }
  private flushOpen = () => {
    if (!this.pendingSession || this.service?.getSnapshot().sessionId !== this.pendingSession) return
    this.pendingSession = undefined
    // A path-bearing open expands the existing tab's actual panel, including a bottom placement.
    this.service.openTab({ type: tabType, path: '' })
  }
  open(sessionId: string) { this.pendingSession = sessionId; this.flushOpen() }
  hide() {
    this.pendingSession = undefined
    if (this.mount) this.service?.closeTab(this.mount.props.tab.id, this.mount.props.scope)
  }
  connect(service: BetterSidebarService) {
    // Browsers without state-preserving moves retain the normal Tylina dock.
    if (typeof (document.body as HTMLElement & { moveBefore?: unknown }).moveBefore !== 'function') return () => {}
    this.service = service
    const integration = this
    function DocumentTab(props: TabComponentProps) {
      const element = useRef<HTMLDivElement>(null)
      useLayoutEffect(() => {
        if (element.current) return integration.attach({ element: element.current, props })
      }, [props.visible, props.scope.sessionId, props.tab.id, props.store])
      return <div ref={element} className="tylina-dsh-tab-host" />
    }
    const unregister = service.registerTab({ id: tabType, title: () => this.title(), single: true, order: 40,
      icon: <img src="/tylina/favicon.svg" width="16" height="16" alt="" />, component: DocumentTab })
    const unregisterViewer = service.registerFileViewer({ id: 'dsh-tylina:typst', title: 'Tylina',
      exts: ['typ'], priority: 10, fetchStrategy: 'none',
      component: ({ scope, path, title }) => <div className="tylina-dsh-file-entry">
        <img src="/tylina/favicon.svg" width="32" height="32" alt="" />
        <strong>{title}</strong>
        <button type="button" onClick={() => integration.onFileOpen?.(scope.sessionId, path)}>
          {integration.openLabel()}
        </button>
      </div> })
    const unsubscribe = service.subscribeState(this.flushOpen)
    this.publish({ available: true, embedded: false, visible: false })
    return () => {
      this.park(); this.mount = undefined; this.service = undefined; this.pendingSession = undefined
      unsubscribe(); unregisterViewer(); unregister()
      this.publish({ available: false, embedded: false, visible: false })
    }
  }
  dispose() { this.park(); this.surface.remove(); this.listeners.clear() }
}

export function registerBetterSidebar(ctx: Context, integration: BetterSidebarIntegration) {
  // Optional reactive service injection: removing this plugin cannot disable Tylina.
  return ctx.inject(['betterSidebar'], (scope) => {
    scope.effect(() => integration.connect(scope.get('betterSidebar') as BetterSidebarService))
  })
}
