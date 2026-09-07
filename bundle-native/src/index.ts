import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { apply as mountTylina, type Config } from '@tylina/dsh-plugin'

export { inject } from '@tylina/dsh-plugin'
export async function apply(ctx: Parameters<typeof mountTylina>[0], config: Config = {}) {
  const runtime = JSON.parse(readFileSync(new URL('../runtime/manifest.json', import.meta.url), 'utf8'))
  if (runtime.platform !== process.platform || runtime.arch !== process.arch) {
    throw new Error(`This Tylina native bundle is for ${runtime.platform}/${runtime.arch}; install the ${process.platform}/${process.arch} artifact`)
  }
  const binary = (name: string) => fileURLToPath(new URL(`../runtime/${name}${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url))
  return mountTylina(ctx, { ...config, mode: 'native',
    sidecar: { command: binary('tylina-tinymist'), args: ['--serve'] },
    languageServer: { command: binary('tinymist'), args: ['lsp'] }
  })
}
