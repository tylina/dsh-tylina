import { verifyEditAnimation } from './edit-animation.mjs'
import { readEditorSource, writeHarnessSource } from './dsh-source.mjs'
import { commandInput } from './command-input.mjs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function verifyInstalledMcp({
  page, frame, root, project, readMain, mode, expectedMissing, probeRequest, mark = () => undefined
}) {
  const require = createRequire(join(root, 'package.json'))
  const { Client, StreamableHTTPClientTransport } = require('@modelcontextprotocol/client')
  const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio')
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
    const transport = process.env.TYLINA_SDK_CLI
      ? new StdioClientTransport({ command: process.execPath, args: [process.env.TYLINA_SDK_CLI, 'mcp'], env: {
        TYLINA_MCP_URL: configuration.url, TYLINA_MCP_TOKEN: configuration.headers.Authorization.slice('Bearer '.length),
      } })
      : new StreamableHTTPClientTransport(new URL(configuration.url), { requestInit: { headers: configuration.headers } })
    await client.connect(transport)
    const catalog = await client.listTools()
    assert.equal(catalog.tools.length, 1)
    assert.match(client.getInstructions(), /one tool named `tylina`/)
    const call = (name, args = {}) => client.callTool(commandInput(name, args))
    const info = (await call('tylina_workspace_info')).structuredContent
    assert.equal(info.root, project)
    const original = await readMain()
    const views = (await call('tylina_view_state')).structuredContent
    assert.notEqual((await call('tylina_set_view', { target: 'mode', value: 'split' })).isError, true)
    await frame.getByTestId('monaco-source-editor').click({ position: { x: 180, y: 12 } })
    await page.keyboard.press('ControlOrMeta+a')
    await button.focus()
    const context = (await call('tylina_editor_context')).structuredContent
    assert.equal(context.selection.text, original, 'stdio reads the real selection after focus leaves the editor')
    assert.equal(context.selection.file, 'Plugin.typ')
    assert.equal(context.selection.sourceSha256, undefined)
    assert.notEqual((await call('tylina_set_view', { target: 'mode', value: views.mode })).isError, true)
    const source = original + '\r\n\r\nEdited through the shared MCP connection.'
    mark('source-edit')
    await writeHarnessSource(probeRequest, source)
    const probe = async input => ({ isError: false, value: await client.callTool({ name: input.name, arguments: input.input }) })
    await expect.poll(async () => (await readEditorSource(page, probe)).text).toBe(source)
    await expect(frame.getByTestId('tylina-root')).toHaveAttribute('data-compile-status', 'success')
    await expect.poll(readMain).toBe(source)
    assert.equal((await call('tylina_validate_document')).structuredContent.valid, true)
    const evaluated = await call('tylina_evaluate_document', {
      expression: 'query(heading).len()'
    })
    assert.equal(evaluated.structuredContent.valid, true)
    assert.equal(evaluated.structuredContent.value, 1)

    mark('import')
    const importDestination = 'output/mcp/imported.md'
    const inspectedImport = await call('tylina_import_document', {
      source: 'source.pdf',
      destination: importDestination,
      expectedDestinationSha256: null,
      allowIncomplete: false
    })
    assert.equal(inspectedImport.structuredContent.status, 'source-hash-required')
    const imported = await call('tylina_import_document', {
      source: 'source.pdf',
      expectedSourceSha256: inspectedImport.structuredContent.sourceSha256,
      destination: importDestination,
      expectedDestinationSha256: null,
      allowIncomplete: false
    })
    assert.equal(imported.structuredContent.status, 'written')
    assert.equal(imported.structuredContent.write.saved, true, JSON.stringify(imported.structuredContent.write))
    assert.match(await readFile(join(project, importDestination), 'utf8'), /Imported through DSH\./u)
    expectedMissing.add(importDestination)

    const image = await call('tylina_render_page', { page: 1, ppi: 48 })
    assert.ok(image.content.some((entry) => entry.type === 'image' && entry.mimeType === 'image/png' && entry.data.length > 100))
    for (const format of ['pdf', 'png', 'svg', 'pptx-visual', 'pptx-editable']) {
      mark(`export-${format}`)
      const presentation = format.startsWith('pptx-')
      const exported = await call('tylina_export_document', {
        format,
        destination: format === 'pdf'
          ? 'output/mcp/document.pdf'
          : presentation
            ? `output/mcp/${format}.pptx`
            : `output/mcp/${format}`,
        ppi: 48
      })
      assert.notEqual(exported.isError, true, JSON.stringify(exported))
      const paths = exported.structuredContent.paths
      assert.ok(paths.length > 0)
      for (const path of paths) {
        expectedMissing.add(path)
        const bytes = await readFile(join(project, path))
        if (format === 'pdf') assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
        else if (format === 'png') assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
        else if (format === 'svg') assert.ok(bytes.toString().includes('<svg'))
        else assert.equal(bytes.subarray(0, 4).toString('hex'), '504b0304')
      }
    }
    assert.match(await readFile(join(info.skillsRoot, 'typst-slides/SKILL.md'), 'utf8'), /Typst/)
    const templates = await call('tylina_list_templates', { query: 'amber', limit: 10 })
    assert.ok(templates.structuredContent.templates.some((entry) => entry.spec.startsWith('tylina:slides/')))
    await verifyEditAnimation({ frame, expect, mark,
      call: (command, args) => client.callTool({ name: 'tylina', arguments: { command, args } }),
      writeSource: (text) => writeHarnessSource(probeRequest, text),
      screenshot: (view) => page.screenshot({ path: join(root, `.benchmarks/dsh-${mode}-animation-${view}.png`) })
    })
    const preparedRestore = await call('tylina_save_workspace')
    assert.equal(preparedRestore.structuredContent.saved, true, JSON.stringify(preparedRestore))
    mark('restore')
    await writeHarnessSource(probeRequest, original)
    await expect.poll(async () => (await readEditorSource(page, probe)).text).toBe(original)
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
