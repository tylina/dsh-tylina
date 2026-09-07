import { cp, mkdir, readFile, writeFile, access, chmod, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyBundledLicenses } from './bundle-licenses.mjs'

const base = dirname(fileURLToPath(import.meta.url))
const { sourceRoot: root } = await import('./source.mjs')
const require = createRequire(join(base, 'plugin/package.json'))
const { build } = require('esbuild')
const target = process.argv[2]
if (target !== 'wasm' && target !== 'native') throw new Error('Choose wasm or native')
const directory = join(base, `bundle-${target}`)
const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
await mkdir(join(directory, 'dist/licenses'), { recursive: true })
await cp(join(root, 'vendor/tinymist/LICENSE'), join(directory, 'dist/licenses/tinymist.txt'))
for (const [dependency, file] of [['react', 'react.txt'], ['react-dom', 'react-dom.txt'], ['@tabler/icons-react', 'tabler-icons.txt']]) {
  await cp(join(dirname(require.resolve(`${dependency}/package.json`)), 'LICENSE'), join(directory, 'dist/licenses', file))
}
const serverBuild = await build({ entryPoints: [join(base, target === 'wasm' ? 'plugin/src/index.ts' : 'bundle-native/src/index.ts')], outfile: join(directory, 'dist/index.js'),
  metafile: true,
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-skill-filesystem', '@deepseek-ai/dsh-session/types', '@deepseek-ai/dsh-llm/message', 'ws'],
  alias: { '@tylina/dsh-plugin': join(base, 'plugin/src/index.ts') },
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" }
})
await copyBundledLicenses(serverBuild.metafile, join(directory, 'dist/licenses'))
// The Harness module table supplies React; Tylina's editor itself stays in its iframe.
await build({ entryPoints: [join(base, 'plugin/src/client/index.tsx')], outfile: join(directory, 'dist/client.js'),
  bundle: true, platform: 'browser', format: 'cjs', target: 'es2022', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/cordis'],
  banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;` },
  footer: { js: 'return module.exports; } });' }
})
{
  const web = join(root, 'apps/web/dist')
  await access(join(web, 'index.html'))
  await rm(join(directory, 'dist/web'), { recursive: true, force: true })
  await cp(web, join(directory, 'dist/web'), { recursive: true, force: true })
  await cp(join(root, 'packages/editor/assets/brand/app.svg'), join(directory, 'dist/web/favicon.svg'))
  await build({ entryPoints: [join(base, 'plugin/src/client/project-window.tsx')],
    outfile: join(directory, 'dist/web/project-window.js'), bundle: true, platform: 'browser', format: 'esm',
    target: 'es2022', jsx: 'automatic', minify: true, define: { 'process.env.NODE_ENV': '"production"' } })
  await writeFile(join(directory, 'dist/web/project-window.html'), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tylina</title><link rel="icon" href="/tylina/favicon.svg"></head>
<body><div id="root"></div><script type="module" src="/tylina/project-window.js"></script></body></html>`)
  await rm(join(directory, 'dist/skills'), { recursive: true, force: true })
  await cp(join(root, 'apps/desktop/resources/skills'), join(directory, 'dist/skills'), { recursive: true })
}
if (target === 'native') {
  const runtime = join(directory, 'runtime')
  await mkdir(runtime, { recursive: true })
  for (const name of ['tinymist', 'tylina-tinymist']) {
    const executable = `${name}${process.platform === 'win32' ? '.exe' : ''}`
    await cp(join(root, 'apps/desktop/resources/runtime', executable), join(runtime, executable))
    if (process.platform !== 'win32') await chmod(join(runtime, executable), 0o755)
  }
  const revision = (await readFile(join(root, 'apps/desktop/resources/runtime/tinymist-revision.txt'), 'utf8')).trim()
  await writeFile(join(runtime, 'manifest.json'), JSON.stringify({ platform: process.platform, arch: process.arch, revision }, null, 2) + '\n')
}
process.stdout.write(`Built ${manifest.name}\n`)
