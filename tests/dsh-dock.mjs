import assert from 'node:assert/strict'
import { join } from 'node:path'

/** Installed Harness acceptance: actual layout, persistence and exclusive project handoff. */
export async function verifyDock({ page, frame, iframe, context, root, mode, readMain, probeRequest, expect, external, menu }) {
  const panel = page.locator('.tylina-dsh-panel')
  assert.equal(await page.locator('dialog[open]').count(), 0)
  const rect = await panel.boundingBox()
  assert.ok(rect.x >= 380 && rect.width >= 420, 'chat and document have separate usable columns')
  assert.equal(await page.locator('body').evaluate((body) => Math.round(body.getBoundingClientRect().width)), Math.round(rect.x))
  const chat = page.locator('[contenteditable="true"]').first()
  await chat.fill('Keep this conversation draft while editing the document.')
  await expect(chat).toBeFocused()
  const chatRect = await chat.boundingBox()
  assert.ok(chatRect.x + chatRect.width <= rect.x + 1, 'chat input is not underneath the document')
  const resize = page.getByRole('separator', { name: /^(调整文档侧栏宽度|Resize document panel)$/u })
  await resize.focus(); await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await panel.boundingBox()).width).toBe(rect.width + 32)
  await resize.press('ArrowRight')
  await expect.poll(async () => (await panel.boundingBox()).width).toBe(rect.width)
  const handle = await resize.boundingBox()
  await page.mouse.move(handle.x + 4, 300); await page.mouse.down()
  await page.mouse.move(handle.x + 68, 300, { steps: 4 }); await page.mouse.up()
  await expect.poll(async () => (await panel.boundingBox()).width).toBe(rect.width - 64)
  await expect(page.locator('.tylina-dsh-drag-shield')).toHaveCount(0)
  await frame.getByRole('button', { name: 'Split', exact: true }).click()
  await expect(frame.locator('.typst-doc')).toBeVisible()
  await expect.poll(readMain).toBe(external)
  await page.screenshot({ path: join(root, `.benchmarks/dsh-${mode}-dock.png`) })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(async () => (await panel.boundingBox()).width).toBe(390)
  await expect(panel).toHaveAttribute('aria-modal', 'true')
  assert.equal(await chat.evaluate((element) => Boolean(element.closest('[inert]'))), true)
  await expect(frame.getByRole('button', { name: 'Main menu', exact: true })).toBeVisible()
  await page.screenshot({ path: join(root, `.benchmarks/dsh-${mode}-narrow.png`) })
  await page.getByRole('button', { name: /^(聚焦此会话|Focus this conversation)$/u }).click()
  await expect(panel).toBeHidden()
  assert.equal(await chat.evaluate((element) => Boolean(element.closest('[inert]'))), false)
  await expect(chat).toHaveText('Keep this conversation draft while editing the document.')
  await page.getByRole('button', { name: /^(打开 Tylina|Open Tylina)$/u }).click()
  await expect(iframe).toBeVisible()
  await page.setViewportSize({ width: 1440, height: 1000 })
  const popoutButton = page.getByRole('button', { name: /^(在独立窗口打开|Open in separate window)$/u })
  await page.evaluate(() => { window.__tylinaWindowOpen = window.open; window.open = () => null })
  try {
    await popoutButton.click()
    await expect(panel.getByRole('alert')).toContainText(/Allow pop-up windows|请允许/u)
    await expect(iframe).toHaveCount(1)
    await expect(iframe).toBeVisible()
    await expect.poll(readMain).toBe(external)
  } finally { await page.evaluate(() => { window.open = window.__tylinaWindowOpen; delete window.__tylinaWindowOpen }) }
  await panel.getByRole('button', { name: /^(关闭提示|Dismiss message)$/u }).click()
  let rejectedSaves = 0
  const rejectSave = async (route) => {
    if (route.request().method() !== 'POST') { await route.continue(); return }
    rejectedSaves++
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Acceptance save rejected' }) })
  }
  await page.route('**/tylina/project?**', rejectSave)
  try {
    await frame.getByRole('button', { name: 'Split', exact: true }).click()
    await frame.getByTestId('monaco-source-editor').click({ position: { x: 150, y: 12 } })
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
    await page.keyboard.insertText(' Unsaved window handoff.')
    await expect.poll(() => rejectedSaves).toBeGreaterThan(0)
    const blockedWindow = context.waitForEvent('page')
    await popoutButton.click()
    const blocked = await blockedWindow
    await expect.poll(() => blocked.isClosed()).toBe(true)
    await expect(iframe).toBeVisible()
    assert.equal(await readMain(), external, 'a rejected save never changes the project on disk')
    const unsaved = (await probeRequest({ name: 'tylina_read_file', input: { file: 'Plugin.typ' } })).value.structuredContent
    assert.equal(unsaved.text, external + ' Unsaved window handoff.', 'failed handoff preserves unsaved editor text')
  } finally { await page.unroute('**/tylina/project?**', rejectSave) }
  await menu('File', 'Save')
  await expect.poll(readMain).toBe(external + ' Unsaved window handoff.')
  const saved = (await probeRequest({ name: 'tylina_read_file', input: { file: 'Plugin.typ' } })).value.structuredContent
  assert.equal((await probeRequest({ name: 'tylina_write_file', input: {
    file: 'Plugin.typ', contents: external, expectedSha256: saved.sha256
  } })).isError, false)
  await expect.poll(readMain).toBe(external)
  await frame.getByRole('button', { name: 'Split', exact: true }).click()
  await panel.getByRole('button', { name: /^(关闭提示|Dismiss message)$/u }).click()
  const popupReady = context.waitForEvent('page')
  await popoutButton.click()
  const popup = await popupReady
  const errors = []
  popup.on('pageerror', (error) => errors.push(error.message))
  await popup.waitForURL('**/tylina/project-window.html?**')
  await expect(panel).toBeHidden()
  await expect(iframe).toHaveCount(0)
  const detached = popup.frameLocator('iframe')
  await expect(detached.locator('.typst-doc')).toBeVisible({ timeout: 30_000 })
  await expect(detached.locator('.web-document-title')).toHaveText('project')
  const toolCount = async () => (await probeRequest({ action: 'catalog' })).filter((tool) => tool.name.startsWith('tylina_')).length
  await expect.poll(toolCount).toBe(18)
  const read = (await probeRequest({ name: 'tylina_read_file', input: { file: 'Plugin.typ' } })).value.structuredContent
  assert.equal(read.text, external)
  const text = external + '\r\n\r\nEdited in a separate window.'
  assert.equal((await probeRequest({ name: 'tylina_write_file', input: {
    file: 'Plugin.typ', contents: text, expectedSha256: read.sha256
  } })).isError, false)
  await expect.poll(readMain).toBe(text)
  await popup.screenshot({ path: join(root, `.benchmarks/dsh-${mode}-window.png`) })
  await popup.getByRole('button', { name: /^(返回侧边栏|Return to sidebar)$/u }).click()
  await expect.poll(() => popup.isClosed()).toBe(true)
  await expect(frame.locator('.typst-doc')).toBeVisible({ timeout: 30_000 })
  await expect.poll(toolCount).toBe(18)
  await expect.poll(readMain).toBe(text)
  const latest = (await probeRequest({ name: 'tylina_read_file', input: { file: 'Plugin.typ' } })).value.structuredContent
  assert.equal(latest.text, text)
  // Restore the fixture through the real tool so the remaining suite has a stable baseline.
  assert.equal((await probeRequest({ name: 'tylina_write_file', input: {
    file: 'Plugin.typ', contents: external, expectedSha256: latest.sha256
  } })).isError, false)
  await expect.poll(readMain).toBe(external)
  await expect(chat).toHaveText('Keep this conversation draft while editing the document.')
  await chat.fill('')
  assert.deepEqual(errors, [])
}
