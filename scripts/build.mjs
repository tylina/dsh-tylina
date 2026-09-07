import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { root } from '../source.mjs'
const target = process.argv[2]
if (target && !['wasm', 'native'].includes(target)) throw new Error('Choose wasm or native')
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
run(process.execPath, ['scripts/version.mjs', '--check'])
for (const mode of target ? [target] : ['wasm', 'native']) run(process.execPath, ['build.mjs', mode])
