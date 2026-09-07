import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { apply as mountTylina, type Config } from '@tylina/dsh-plugin'

export { inject } from '@tylina/dsh-plugin'
export async function apply(ctx: Parameters<typeof mountTylina>[0], config: Config = {}) {
  const name = `tylina-native-${process.platform}-${process.arch}`
  let root: string
  try { root = dirname(createRequire(import.meta.url).resolve(`${name}/package.json`)) }
  catch { throw new Error(`Tylina native runtime ${name} is unavailable. Install optional dependencies, or use dsh-tylina (WASM).`) }
  const runtime = JSON.parse(readFileSync(join(root, 'runtime/manifest.json'), 'utf8'))
  if (runtime.platform !== process.platform || runtime.arch !== process.arch) {
    throw new Error(`Tylina runtime platform mismatch: expected ${process.platform}/${process.arch}`)
  }
  const binary = (name: string) => join(root, 'runtime', `${name}${process.platform === 'win32' ? '.exe' : ''}`)
  return mountTylina(ctx, { ...config, mode: 'native',
    sidecar: { command: binary('tylina-tinymist'), args: ['--serve'] },
    languageServer: { command: binary('tinymist'), args: ['lsp'] }
  })
}
