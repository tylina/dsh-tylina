import { attachProjectLauncher, type ProjectLauncherOptions, type ProjectWindow } from './window-launcher'
import { forgetProjectWindow, projectWindowName, rememberProjectWindow, type ProjectSelection } from './window-record'
export type { ProjectWindow } from './window-launcher'

/** The new window owns its iframe and connections; the launcher never transfers a live iframe across documents. */
export function createProjectWindow(options: ProjectLauncherOptions & {
  project: ProjectSelection; release(remember: () => void): Promise<void>
}): ProjectWindow {
  // Reserve the window synchronously in the click, before the asynchronous save guard.
  const record = { token: crypto.randomUUID(), project: options.project }
  const popup = window.open('about:blank', projectWindowName(record), 'popup,width=1200,height=900')
  if (!popup) throw new Error(options.t('blocked'))
  popup.document.title = 'Tylina'
  popup.document.body.textContent = options.t('loading')
  const launcher = attachProjectLauncher(record, options, popup, false)
  void options.release(() => rememberProjectWindow(record)).then(() => {
    launcher.activate()
    if (popup.closed) return
    const url = new URL('/tylina/project-window.html', location.href)
    url.searchParams.set('session', options.project.sessionId)
    url.searchParams.set('project', options.project.project)
    url.searchParams.set('bridge', record.token)
    url.searchParams.set('locale', options.t('open') === 'Open Tylina' ? 'en' : 'zh')
    popup.location.replace(url.href)
  }).catch(() => { forgetProjectWindow(record); launcher.dispose(); popup.close() })
  return launcher
}
