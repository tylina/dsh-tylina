import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
export const root = fileURLToPath(new URL('./', import.meta.url))
const require = createRequire(import.meta.url)
export const assetsRoot = dirname(require.resolve('tylina-web-assets/package.json'))
