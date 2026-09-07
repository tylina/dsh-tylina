import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { root } from '../source.mjs'
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const release = join(root, 'release')
const { artifacts } = JSON.parse(readFileSync(join(release, 'manifest.json'), 'utf8'))
assert.equal(artifacts.length, 2)
for (const artifact of artifacts) {
  const archive = join(release, artifact.file)
  const bytes = readFileSync(archive)
  assert.equal(bytes.length, artifact.bytes)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256)
  const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n')
  const manifest = JSON.parse(execFileSync('tar', ['-xOzf', archive, 'package/package.json'], { encoding: 'utf8' }))
  assert.equal(manifest.version, version)
  assert.equal(manifest.private, undefined)
  for (const dependency of Object.values({ ...manifest.dependencies, ...manifest.peerDependencies })) {
    assert.ok(!dependency.startsWith('workspace:') && !dependency.startsWith('file:') && !dependency.startsWith('link:'))
  }
  for (const path of ['dist/index.js', 'dist/client.js', 'dist/web/project-window.html', 'cordis.patch.yml']) assert.ok(names.includes(`package/${path}`), path)
  assert.ok(!names.some((path) => path.includes('/node_modules/') || path.startsWith('package/plugin/src/') || path.startsWith('package/.tylina/')))
  assert.equal(manifest.dependencies['tylina-web-assets'], version)
  assert.ok(artifact.bytes < 20 * 1024 * 1024, 'Integration must reuse shared npm resources')
  assert.equal(manifest.os, undefined)
  assert.equal(manifest.cpu, undefined)
  if (manifest.name === 'dsh-tylina-native') {
    assert.equal(Object.keys(manifest.optionalDependencies).length, 6)
    assert.ok(!names.some((name) => name.startsWith('package/runtime/')))
  }
  console.log(`Verified ${artifact.file} (${bytes.length} bytes)`)
}
