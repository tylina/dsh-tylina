import type { EmbeddedWorkspace } from '@tylina/editor-host/embedded-workspace'
import { decodeBase64, encodeBase64 } from '@tylina/editor-host/base64'

export type WorkspaceWire = Omit<EmbeddedWorkspace, 'resources'> & { resources: Record<string, string> }
export interface ProjectSnapshot { workspace: WorkspaceWire; revision: string; mode: 'wasm' | 'native' }

export function encodeWorkspace(workspace: EmbeddedWorkspace): WorkspaceWire {
  return { ...workspace, resources: Object.fromEntries(Object.entries(workspace.resources ?? {}).map(([path, bytes]) => [path, encodeBase64(bytes)])) }
}

export function decodeWorkspace(input: WorkspaceWire): EmbeddedWorkspace {
  if (!input || typeof input !== 'object' || !input.files || typeof input.files !== 'object' ||
    !input.resources || typeof input.resources !== 'object') throw new Error('Invalid project snapshot')
  const resources = Object.entries(input.resources)
  if (resources.length + Object.keys(input.files).length > 4096) throw new Error('The project exceeds 4096 files')
  let total = 0
  for (const text of Object.values(input.files)) {
    if (typeof text !== 'string') throw new Error('Invalid project text')
    const bytes = new TextEncoder().encode(text).length
    total += bytes
    if (bytes > 64 * 1024 * 1024 || total > 128 * 1024 * 1024) throw new Error('The project exceeds its byte limit')
  }
  return { ...input, resources: Object.fromEntries(resources.map(([path, value]) => {
    const bytes = decodeBase64(value, Math.min(64 * 1024 * 1024, 128 * 1024 * 1024 - total))
    total += bytes.length
    return [path, bytes]
  })) }
}
