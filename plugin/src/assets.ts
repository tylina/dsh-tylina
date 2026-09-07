import { createReadStream } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.zip': 'application/zip'
}

export async function createAssetHandler(root: string, configuration: { mode: 'wasm' | 'native'; endpoint?: string }, additionalRoots: string[] = []) {
  const directories = await Promise.all([root, ...additionalRoots].map((path) => realpath(path)))
  const locate = async (name: string) => {
    for (const directory of directories) {
      try {
        const file = await realpath(resolve(directory, name)), path = relative(directory, file)
        if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`)) throw new Error('Outside assets')
        if ((await stat(file)).isFile()) return file
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && (error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error
      }
    }
    throw new Error('Asset not found')
  }
  const index = (await readFile(await locate('index.html'), 'utf8')).replace('</head>',
    `<script type="application/json" id="tylina-host-runtime">${JSON.stringify(configuration).replaceAll('<', '\\u003c')}</script></head>`)
  return async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return }
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname === '/tylina') { response.writeHead(308, { Location: `/tylina/${url.search}` }); response.end(); return }
    const name = decodeURIComponent(url.pathname.slice('/tylina/'.length))
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Referrer-Policy', 'same-origin')
    response.setHeader('X-Frame-Options', 'SAMEORIGIN')
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
    if (name === '' || name === 'index.html') {
      response.writeHead(200, { 'Content-Type': mime['.html'], 'Cache-Control': 'no-store', 'X-Tylina-Runtime': configuration.mode })
      response.end(request.method === 'HEAD' ? undefined : index); return
    }
    try {
      const file = await locate(name)
      const info = await stat(file)
      if (!info.isFile()) throw new Error('Not a file')
      response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
        'Content-Length': info.size, 'Cache-Control': 'no-cache' })
      if (request.method === 'HEAD') { response.end(); return }
      await pipeline(createReadStream(file), response)
    } catch {
      if (!response.headersSent) { response.writeHead(404); response.end() }
      else response.destroy()
    }
  }
}
