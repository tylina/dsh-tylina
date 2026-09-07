import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('./', import.meta.url))
const destination = join(root, 'release')
await mkdir(destination, { recursive: true })
const artifacts = []
for (const mode of ['wasm', 'native']) {
  const name = `@tylina/dsh-${mode}`
  const manifestPath = join(root, `bundle-${mode}/package.json`)
  const original = await readFile(manifestPath, 'utf8')
  if (mode === 'native') await writeFile(manifestPath, JSON.stringify({ ...JSON.parse(original), os: [process.platform], cpu: [process.arch] }, null, 2) + '\n')
  let result
  try { result = spawnSync('pnpm', ['--filter', name, 'pack', '--pack-destination', destination], { cwd: root, stdio: 'inherit' }) }
  finally { await writeFile(manifestPath, original) }
  if (result.status !== 0) process.exit(result.status ?? 1)
  const { version } = JSON.parse(await readFile(join(root, `bundle-${mode}/package.json`), 'utf8'))
  const file = `tylina-dsh-${mode}-${version}.tgz`
  const bytes = await readFile(join(destination, file))
  artifacts.push({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    ...(mode === 'native' ? { platform: process.platform, arch: process.arch } : {}) })
}
await writeFile(join(destination, 'manifest.json'), JSON.stringify({ artifacts }, null, 2) + '\n')
