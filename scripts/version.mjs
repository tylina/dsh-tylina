import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const files = ['package.json', 'plugin/package.json', 'bundle-wasm/package.json', 'bundle-native/package.json']
const manifests = await Promise.all(files.map(async (file) => {
  const path = fileURLToPath(new URL(`../${file}`, import.meta.url))
  return { path, value: JSON.parse(await readFile(path, 'utf8')) }
}))
const version = process.argv[2]
if (version === '--check') {
  for (const { value } of manifests) {
    assert.equal(value.version, manifests[0].value.version, `${value.name}: run pnpm release:version <version>`)
  }
} else {
  assert.match(version ?? '', /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Provide a stable version, for example 0.4.4')
  for (const { path, value } of manifests) {
    value.version = version
    await writeFile(path, JSON.stringify(value, null, 2) + '\n')
  }
}
