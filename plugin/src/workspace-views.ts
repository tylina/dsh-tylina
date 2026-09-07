import type { WorkspaceFileSystem } from 'tylina-sdk/client'
import type { createNodeWorkspacePool } from 'tylina-sdk/node'

type Pool = ReturnType<typeof createNodeWorkspacePool>
type Lease = Awaited<ReturnType<Pool['acquire']>>

/** A document view owns its cache independently of Agent/tool connections. */
export function createWorkspaceViews(pool: Pool, idleMs = 5 * 60_000) {
  interface View { path: string; lease: Promise<Lease>; active: number; closed: boolean;
    timer?: ReturnType<typeof setTimeout>; drained?: () => void; release?: Promise<void> }
  const views = new Map<string, View>()
  const releasing = new Set<Promise<void>>()
  let disposed = false
  const release = (key: string, view: View): Promise<void> => view.release ??= (async () => {
    view.closed = true; clearTimeout(view.timer)
    if (views.get(key) === view) views.delete(key)
    if (view.active) await new Promise<void>((resolve) => { view.drained = resolve })
    await (await view.lease).release()
  })()
  const close = (key: string, view: View) => {
    const pending = release(key, view)
    releasing.add(pending)
    void pending.finally(() => releasing.delete(pending)).catch(() => undefined)
    return pending
  }
  return {
    async use<T>(key: string, path: string, fileSystem: WorkspaceFileSystem, action: (store: Lease['store']) => Promise<T>): Promise<T> {
      if (disposed) throw new Error('The workspace views are closed')
      let view = views.get(key)
      if (view && view.path !== path) throw new Error('This session changed its working directory. Reopen the document workspace.')
      if (!view) {
        if (views.size >= 16) throw new Error('Too many document workspaces are open')
        view = { path, lease: pool.acquire(path, fileSystem), active: 0, closed: false }
        views.set(key, view)
      }
      const owner = view
      clearTimeout(owner.timer)
      owner.active++
      try {
        const lease = await owner.lease.catch((error) => { void close(key, owner).catch(() => undefined); throw error })
        return await action(lease.store)
      } finally {
        if (--owner.active === 0) {
          if (owner.closed) owner.drained?.()
          else {
            owner.timer = setTimeout(() => { void close(key, owner).catch(() => undefined) }, idleMs)
            owner.timer.unref?.()
          }
        }
      }
    },
    async release(key: string) { const view = views.get(key); if (view) await close(key, view) },
    async dispose() {
      disposed = true
      for (const [key, view] of views) void close(key, view).catch(() => undefined)
      await Promise.allSettled([...releasing])
    }
  }
}
