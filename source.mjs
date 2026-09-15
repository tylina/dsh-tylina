import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { accessSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const root = fileURLToPath(new URL('./', import.meta.url))
const require = createRequire(import.meta.url)
const pluginRequire = createRequire(join(root, 'plugin/package.json'))

function packageRoot(name, candidate, resolver = require) {
  const manifestPath = candidate
    ? join(resolve(candidate), 'package.json')
    : resolver.resolve(`${name}/package.json`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.name !== name) {
    throw new Error(`Expected ${name} at ${manifestPath}, found ${String(manifest.name)}`)
  }
  return dirname(manifestPath)
}

export const publishedAssetsRoot = packageRoot('tylina-web-assets')
export const assetsRoot = process.env.TYLINA_DSH_WEB_ASSETS
  ? packageRoot('tylina-web-assets', process.env.TYLINA_DSH_WEB_ASSETS)
  : publishedAssetsRoot
export const sdkRoot = packageRoot('tylina-sdk', process.env.TYLINA_DSH_SDK, pluginRequire)
export const sdkAliases = Object.fromEntries([
  ['client', 'dist/client.js'],
  ['node', 'dist/node.js'],
  ['protocol', 'dist/protocol.js'],
  ['tools', 'dist/tools.js'],
  ['tool-names.json', 'tool-names.json']
].map(([entry, path]) => {
  const target = join(sdkRoot, path)
  accessSync(target)
  return [`tylina-sdk/${entry}`, target]
}))
