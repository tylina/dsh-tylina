import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'

export async function verifyInstalledMcp({ page, frame, root, project, readMain, mode }) {
  const require = createRequire(join(root, 'package.json'))
  const { Client, StreamableHTTPClientTransport } = require('@modelcontextprotocol/client')
  const { expect } = createRequire(join(root, 'package.json'))('@playwright/test')
  const button = page.getByRole('button', { name: /^(连接 MCP 客户端|Connect an MCP client)$/u })
  const copy = async () => {
    await button.click()
    const dialog = page.getByRole('dialog', { name: /^(连接 MCP 客户端|Connect an MCP client)$/u })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /^(复制配置|Copy configuration)$/u }).click()
    await expect(dialog.getByRole('status')).toHaveText(/^(已复制|Copied)$/u)
    const configuration = await page.evaluate(() => navigator.clipboard.readText())
    await page.screenshot({ path: join(root, `.benchmarks/dsh-${mode}-mcp.png`) })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(button).toBeFocused()
    return JSON.parse(configuration).mcpServers.tylina
  }
  const configuration = await copy()
  assert.equal((await fetch(configuration.url, { method: 'POST' })).status, 401)
  const client = new Client({ name: 'installed-bundle-acceptance', version: 'test' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(configuration.url), { requestInit: { headers: configuration.headers } }))
    const catalog = await client.listTools()
    assert.equal(catalog.tools.length, 18)
    assert.match(client.getInstructions(), /session-scoped Typst authoring contract/)
    const call = (name, args = {}) => client.callTool({ name, arguments: args })
    const info = (await call('tylina_workspace_info')).structuredContent
    assert.equal(info.root, project)
    const read = (await call('tylina_read_file', { file: 'Plugin.typ' })).structuredContent
    const original = await readMain()
    assert.equal(read.text, original)
    const source = original + '\r\n\r\nEdited through the shared MCP connection.'
    assert.notEqual((await call('tylina_write_file', { file: 'Plugin.typ', contents: source, expectedSha256: read.sha256 })).isError, true)
    await expect.poll(readMain).toBe(source)
    assert.equal((await call('tylina_validate_document')).structuredContent.valid, true)
    const image = await call('tylina_render_page', { page: 1, ppi: 48 })
    assert.ok(image.content.some((entry) => entry.type === 'image' && entry.mimeType === 'image/png' && entry.data.length > 100))
    const skill = await call('tylina_read_skill_resource', { path: 'typst-slides/SKILL.md' })
    assert.equal(skill.structuredContent.available, true, JSON.stringify(skill.structuredContent))
    assert.ok(skill.content.some((entry) => entry.type === 'text' && entry.text.includes('Typst')))
    const templates = await call('tylina_list_templates', { query: 'amber', limit: 10 })
    assert.ok(templates.structuredContent.templates.some((entry) => entry.spec.startsWith('tylina:slides/')))
    const next = (await call('tylina_read_file', { file: 'Plugin.typ' })).structuredContent
    assert.notEqual((await call('tylina_write_file', { file: 'Plugin.typ', contents: original, expectedSha256: next.sha256 })).isError, true)
    await expect.poll(readMain).toBe(original)
    await expect(frame.getByTestId('external-edit-transition')).toHaveCount(0)
    await page.getByRole('button', { name: /^(重新连接 Agent 工具|Reconnect Agent tools)$/u }).click()
    await expect.poll(async () => (await fetch(configuration.url, { method: 'POST', headers: configuration.headers })).status).toBe(404)
    // A fresh capability is required; reconnecting never retargets an old MCP client.
    const replacement = await copy()
    assert.notEqual(replacement.url, configuration.url)
    assert.notEqual(replacement.headers.Authorization, configuration.headers.Authorization)
  } finally { await client.close() }
}
