export interface ProjectSelection { sessionId: string; project: string }
export interface ProjectWindowRecord { token: string; project: ProjectSelection }
const key = 'tylina.dsh.detached-window'

/** Launcher metadata only; documents, credentials and tool capabilities remain with their owners. */
export function readProjectWindow(): ProjectWindowRecord | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    if (typeof value?.token !== 'string' || value.token.length !== 36 ||
      typeof value.project?.sessionId !== 'string' || !value.project.sessionId.length || value.project.sessionId.length > 256 ||
      typeof value.project.project !== 'string' || value.project.project.length > 2048) return
    return { token: value.token, project: { sessionId: value.project.sessionId, project: value.project.project } }
  } catch { return }
}
export function rememberProjectWindow(record: ProjectWindowRecord, target: Window = window) {
  target.sessionStorage.setItem(key, JSON.stringify(record))
}
export function forgetProjectWindow(record: ProjectWindowRecord) {
  if (readProjectWindow()?.token === record.token) sessionStorage.removeItem(key)
}
export const projectWindowName = (record: ProjectWindowRecord) => `tylina-${record.token}`
export const launcherChannel = (record: ProjectWindowRecord) => new BroadcastChannel(`tylina.dsh.launcher.${record.token}`)
