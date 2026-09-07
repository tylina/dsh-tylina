import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { createExecutableInspector, resolveConfiguredExecutable } from 'tylina-sdk/node'
import { createManagedToolRuntime, resolveInstalledUv, type TylinaToolRuntime } from 'tylina-sdk/node'
import { createStandaloneUvInstaller } from 'tylina-sdk/node'
import type { ToolResult } from 'tylina-sdk/tools'
import type { EditorToolCaller } from './tools'
import toolNames from 'tylina-sdk/tool-names.json' with { type: 'json' }

export function createHarnessToolRuntime(): TylinaToolRuntime {
  const inspect = createExecutableInspector(process.platform)
  const canExecute = (path: string) => isAbsolute(path) ? inspect(path) : Promise.resolve(false)
  return createManagedToolRuntime({ runtimeRootPath: join(resolveDshHome(), 'tylina', 'tool-runtime'), platform: process.platform,
    canExecute, resolveSystemUv: () => resolveInstalledUv({ platform: process.platform, env: process.env,
      homeDirectory: homedir(), canExecute, resolveOnPath: () => resolveConfiguredExecutable('uv', {
        env: process.env, platform: process.platform, canExecute
      }) }), installManagedUv: createStandaloneUvInstaller({ platform: process.platform }) })
}

/** The live editor owns document bytes; the Node host owns script paths and the reusable uv installation. */
export function withHarnessToolRuntime(call: EditorToolCaller, runtime: TylinaToolRuntime, root: string, skillsRoot: string): EditorToolCaller {
  const result = (value: object): ToolResult => ({ structuredContent: value, content: [{ type: 'text', text: JSON.stringify(value) }] })
  return async (name, input, signal) => {
    signal.throwIfAborted()
    if (name === toolNames.toolRuntime) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid tool runtime request')
      const retry = (input as { retry?: unknown }).retry
      if (retry !== undefined && typeof retry !== 'boolean') throw new Error('Invalid tool runtime retry flag')
      const value = await runtime.request({ retry })
      signal.throwIfAborted()
      return result({ ...value, workspaceRoot: root, skillsRoot })
    }
    const value = await call(name, input, signal)
    if (name !== toolNames.workspaceInfo || value.isError || !value.structuredContent) return value
    return result({ ...value.structuredContent, root, skillsRoot })
  }
}
