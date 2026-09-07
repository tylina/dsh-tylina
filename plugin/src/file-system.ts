import { posix } from 'node:path'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import type { WorkspaceFileSystem, WorkspaceDirectoryEntry } from 'tylina-sdk/client'
import { requireWorkspaceRelativePath } from 'tylina-sdk/node'

/** DSH owns the filesystem world. All byte reads use its provider, including WASM dependencies. */
export function createHarnessFileSystem(fs: FileSystem, root: FsTarget): WorkspaceFileSystem {
  const cwd = fs.processPath(root)
  const resolve = async (path: string, signal?: AbortSignal) => {
    if (!path) return root
    requireWorkspaceRelativePath(path)
    const target = await fs.resolve(path, { cwd, signal })
    if (!fs.contains(root, target)) throw new Error('The file is outside the Harness workspace')
    return target
  }
  return {
    async stat(path, signal) {
      const info = await fs.stat(await resolve(path, signal), signal)
      if (!info) return null
      if (info.type === 'other') throw new Error(`The requested path is not a regular file or directory: ${path}`)
      return { kind: info.type, version: info.version, size: info.size }
    },
    async readDirectory(path, signal) {
      const entries: WorkspaceDirectoryEntry[] = []
      for (const entry of await fs.listDir(await resolve(path, signal), signal)) {
        const child = posix.join(path, entry.name)
        try { requireWorkspaceRelativePath(child) } catch { continue }
        if (entry.type === 'other' || !fs.contains(root, entry.target)) continue
        // Do not follow directory aliases while enumerating: cycles and unrelated links are not project content.
        const pathInfo = await fs.lstat(child, { cwd }, signal)
        if (!pathInfo || pathInfo.type === 'symlink' || pathInfo.type === 'other') continue
        const info = await fs.stat(entry.target, signal)
        if (info && info.type !== 'other') entries.push({ name: entry.name, kind: info.type, version: info.version, size: info.size })
      }
      return entries
    },
    async readFile(path, signal) {
      const target = await resolve(path, signal)
      const before = await fs.stat(target, signal)
      if (!before) return null
      if (before.type !== 'file') throw new Error(`The requested path is not a file: ${path}`)
      const bytes = await fs.readBytes(target, signal, 64 * 1024 * 1024)
      const after = await fs.stat(await resolve(path, signal), signal)
      if (!after || after.version !== before.version) throw new Error(`The file changed while being read: ${path}`)
      return { bytes, version: after.version }
    }
  }
}
