import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('./', import.meta.url))
const check = spawnSync(process.execPath, ['scripts/version.mjs', '--check'], { cwd: root, stdio: 'inherit' })
if (check.status !== 0) process.exit(check.status ?? 1)
const destination = join(root, 'release')
await mkdir(destination, { recursive: true })
const artifacts = []
for (const mode of ['wasm', 'native']) {
  const name = mode === 'wasm' ? 'dsh-tylina' : 'dsh-tylina-native'
  const result = spawnSync('pnpm', ['--filter', name, 'pack', '--pack-destination', destination], { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
  const { version } = JSON.parse(await readFile(join(root, `bundle-${mode}/package.json`), 'utf8'))
  const file = `${name}-${version}.tgz`
  const bytes = await readFile(join(destination, file))
  artifacts.push({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
}
await writeFile(join(destination, 'manifest.json'), JSON.stringify({ artifacts }, null, 2) + '\n')
