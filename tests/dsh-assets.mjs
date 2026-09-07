import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises'
import { createServer, request } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const require = createRequire(new URL('../plugin/package.json', import.meta.url))
test('shared assets preserve custom routes, serve lazy fonts, and reject escaping any resource root', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-assets-'))
  let server
  try {
    const custom = join(temporary, 'custom'), web = join(temporary, 'web'), fonts = join(temporary, 'fonts')
    await Promise.all([custom, web, join(fonts, 'assets')].map((path) => mkdir(path, { recursive: true })))
    await writeFile(join(web, 'index.html'), '<head></head><body>Editor</body>')
    await writeFile(join(custom, 'project-window.html'), 'Custom window')
    await writeFile(join(web, 'project-window.html'), 'Wrong window')
    await writeFile(join(fonts, 'assets/example.otf'), 'Font bytes')
    await writeFile(join(temporary, 'private.txt'), 'Private')
    await symlink(join(temporary, 'private.txt'), join(fonts, 'assets/escape.txt'))
    await require('esbuild').build({ entryPoints: [new URL('../plugin/src/assets.ts', import.meta.url).pathname],
      outfile: join(temporary, 'assets.cjs'), bundle: true, platform: 'node', format: 'cjs' })
    const { createAssetHandler } = require(join(temporary, 'assets.cjs'))
    const handler = await createAssetHandler(custom, { mode: 'wasm' }, [web, fonts])
    server = createServer((request, response) => { void handler(request, response) })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const get = (path, method = 'GET') => new Promise((resolve, reject) => {
      const call = request({ hostname: '127.0.0.1', port: server.address().port, path, method }, (response) => {
        let body = ''; response.setEncoding('utf8'); response.on('data', (chunk) => { body += chunk })
        response.on('end', () => resolve({ status: response.statusCode, body, headers: response.headers }))
      }); call.on('error', reject); call.end()
    })
    assert.match((await get('/tylina/')).body, /tylina-host-runtime/)
    assert.equal((await get('/tylina/project-window.html')).body, 'Custom window')
    const font = await get('/tylina/assets/example.otf')
    assert.equal(font.status, 200); assert.equal(font.body, 'Font bytes'); assert.equal(font.headers['content-type'], 'font/otf')
    const head = await get('/tylina/assets/example.otf', 'HEAD')
    assert.equal(head.status, 200); assert.equal(head.body, ''); assert.equal(head.headers['content-length'], '10')
    for (const path of ['assets/escape.txt', '..%2fprivate.txt', 'assets/missing.otf']) {
      assert.equal((await get(`/tylina/${path}`)).status, 404)
    }
    assert.equal((await get('/tylina/assets/example.otf', 'POST')).status, 405)
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve))
    await rm(temporary, { recursive: true, force: true })
  }
})
