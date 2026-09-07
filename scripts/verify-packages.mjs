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
  for (const path of ['dist/index.js', 'dist/client.js', 'dist/web/index.html', 'dist/skills/typst-authoring/SKILL.md', 'cordis.patch.yml']) assert.ok(names.includes(`package/${path}`), path)
  assert.ok(!names.some((path) => path.includes('/node_modules/') || path.startsWith('package/plugin/src/') || path.startsWith('package/.tylina/')))
  if (artifact.platform) {
    const runtime = JSON.parse(execFileSync('tar', ['-xOzf', archive, 'package/runtime/manifest.json'], { encoding: 'utf8' }))
    assert.equal(runtime.platform, artifact.platform)
    assert.equal(runtime.arch, artifact.arch)
    assert.deepEqual(manifest.os, [runtime.platform])
    assert.deepEqual(manifest.cpu, [runtime.arch])
  }
  console.log(`Verified ${artifact.file} (${bytes.length} bytes)`)
}
