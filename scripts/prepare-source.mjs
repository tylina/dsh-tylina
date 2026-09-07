import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { root, sourceRoot } from '../source.mjs'
const pin = JSON.parse(readFileSync(join(root, 'tylina-source.json'), 'utf8'))
function git(args, cwd = sourceRoot) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim() }
if (!existsSync(join(sourceRoot, '.git'))) {
  mkdirSync(sourceRoot, { recursive: true })
  git(['init'])
  git(['remote', 'add', 'origin', pin.repository])
}
if (git(['remote', 'get-url', 'origin']) !== pin.repository) throw new Error('Unexpected Tylina source remote')
if (git(['status', '--porcelain', '--untracked-files=no'])) throw new Error('Tylina source has local edits; commit or stash before changing its pin')
try { git(['cat-file', '-e', `${pin.revision}^{commit}`]) }
catch { git(['fetch', '--depth=1', 'origin', pin.revision]) }
git(['checkout', '--detach', pin.revision])
// Never recursively initialize the integration: this source dependency is deliberately one-way.
git(['submodule', 'update', '--init', '--depth=1', 'vendor/tinymist'])
if (JSON.parse(readFileSync(join(sourceRoot, 'package.json'), 'utf8')).version !== pin.version) throw new Error('Tylina version does not match its pin')
mkdirSync(join(root, '.benchmarks'), { recursive: true })
console.log(`Prepared Tylina ${pin.version} (${pin.revision})`)
