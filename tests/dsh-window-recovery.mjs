import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

/** A detached editor keeps its real workspace and tools when its original launcher disappears. */
export async function verifyWindowRecovery({ page, context, root, mode, sessionId, readMain, expect }) {
  const probe = (owner, input) => owner.evaluate(async (input) => {
    const response = await fetch('/tylina-acceptance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    if (!response.ok) throw new Error(await response.text())
    return response.json()
  }, { sessionId, ...input })
  const popout = async (owner) => {
    const ready = context.waitForEvent('page')
    await owner.getByRole('button', { name: /^(在独立窗口打开|Open in separate window)$/u }).click()
    const popup = await ready
    await popup.waitForURL('**/tylina/project-window.html?**')
    await expect(popup.frameLocator('iframe').locator('.typst-doc')).toBeVisible({ timeout: 30_000 })
    return popup
  }
  const original = await readMain()
  let popup = await popout(page)
  await page.reload()
  await expect(page.getByRole('button', { name: /^(打开 Tylina|Open Tylina)$/u })).toBeVisible({ timeout: 30_000 })
  const rejectSave = async (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Acceptance save rejected' }) })
    : route.continue()
  await popup.route('**/tylina/project?**', rejectSave)
  try {
    const frame = popup.frameLocator('iframe')
    await frame.getByRole('button', { name: 'Split', exact: true }).click()
    await frame.getByTestId('monaco-source-editor').click({ position: { x: 150, y: 12 } })
    await popup.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
    await popup.keyboard.insertText(' Keep this unsaved document.')
    await popup.getByRole('button', { name: /^(返回侧边栏|Return to sidebar)$/u }).click()
    await expect(popup.getByRole('alert')).toContainText(/save issue|保存问题/u)
    assert.equal(popup.isClosed(), false)
    await expect(page.locator('.tylina-dsh-panel iframe')).toHaveCount(0)
    const unsaved = (await probe(popup, { name: 'tylina_read_file', input: { file: 'Plugin.typ' } })).value.structuredContent
    assert.equal(unsaved.text, original + ' Keep this unsaved document.')
    assert.equal(await readMain(), original)
  } finally { await popup.unroute('**/tylina/project?**', rejectSave) }
  const unsaved = (await probe(popup, { name: 'tylina_read_file', input: { file: 'Plugin.typ' } })).value.structuredContent
  assert.equal((await probe(popup, { name: 'tylina_write_file', input: {
    file: 'Plugin.typ', contents: original, expectedSha256: unsaved.sha256
  } })).isError, false)
  await popup.getByRole('button', { name: /^(返回侧边栏|Return to sidebar)$/u }).click()
  await expect.poll(() => popup.isClosed(), { timeout: 30_000 }).toBe(true)
  await expect(page.frameLocator('.tylina-dsh-panel iframe').locator('.typst-doc')).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => (await probe(page, { action: 'catalog' })).filter((tool) => tool.name.startsWith('tylina_')).length).toBe(18)
  assert.equal(await readMain(), original)
  popup = await popout(page)
  await page.close()
  await popup.evaluate(() => { window.__tylinaWindowOpen = window.open; window.open = () => null })
  try {
    await popup.getByRole('button', { name: /^(聚焦此会话|Focus this conversation)$/u }).click()
    await expect(popup.getByRole('alert')).toContainText(/Allow pop-up windows|请允许/u)
    assert.equal(context.pages().length, 1)
    await expect(popup.frameLocator('iframe').locator('.typst-doc')).toBeVisible()
  } finally { await popup.evaluate(() => { window.open = window.__tylinaWindowOpen; delete window.__tylinaWindowOpen }) }
  const read = (await probe(popup, { name: 'tylina_read_file', input: { file: 'Plugin.typ' } })).value.structuredContent
  const changed = original + '\r\n\r\nThe detached workspace survives its launcher.\r\n'
  const requested = original + '\n\nThe detached workspace survives its launcher.\n'
  const written = await probe(popup, { name: 'tylina_write_file', input: {
    file: 'Plugin.typ', contents: requested, expectedSha256: read.sha256
  } })
  assert.equal(written.isError, false, JSON.stringify({ written, requested, stored: await readMain(),
    current: await probe(popup, { name: 'tylina_read_file', input: { file: 'Plugin.typ' } }) }))
  assert.deepEqual(written.value.structuredContent.files, [{ file: 'Plugin.typ',
    sha256: createHash('sha256').update(changed).digest('hex'), lineEndingsNormalized: true }])
  await expect.poll(readMain).toBe(changed)
  const reopened = context.waitForEvent('page')
  await popup.getByRole('button', { name: /^(聚焦此会话|Focus this conversation)$/u }).click()
  const parent = await reopened
  await expect(parent.getByRole('button', { name: /^(打开 Tylina|Open Tylina)$/u })).toBeVisible({ timeout: 30_000 })
  await expect(parent.locator('.tylina-dsh-panel iframe')).toHaveCount(0)
  const chat = parent.locator('[contenteditable="true"]').first()
  await chat.fill('Preserve my conversation draft when the document window reloads.')
  let navigations = 0
  parent.on('framenavigated', (frame) => { if (frame === parent.mainFrame()) navigations++ })
  await expect.poll(async () => (await probe(popup, { action: 'catalog' })).filter((tool) => tool.name.startsWith('tylina_')).length).toBe(18)
  await popup.reload()
  await expect(popup.frameLocator('iframe').locator('.typst-doc')).toBeVisible({ timeout: 30_000 })
  await popup.getByRole('button', { name: /^(返回侧边栏|Return to sidebar)$/u }).click()
  await expect.poll(() => popup.isClosed(), { timeout: 30_000 }).toBe(true)
  await expect(parent.frameLocator('.tylina-dsh-panel iframe').locator('.typst-doc')).toBeVisible({ timeout: 30_000 })
  assert.equal(navigations, 0, 'returning a reloaded popup must not reload an already open Harness tab')
  await expect(chat).toHaveText('Preserve my conversation draft when the document window reloads.')
  const restored = (await probe(parent, { name: 'tylina_read_file', input: { file: 'Plugin.typ' } })).value.structuredContent
  assert.equal(restored.text, changed)
  popup = await popout(parent)
  await parent.reload()
  await expect(parent.getByRole('button', { name: /^(打开 Tylina|Open Tylina)$/u })).toBeVisible({ timeout: 30_000 })
  // Readiness after reload reconnects the launcher without claiming document tools.
  await popup.bringToFront()
  await expect(parent.locator('.tylina-dsh-panel iframe')).toHaveCount(0)
  await popup.close()
  await expect(parent.frameLocator('.tylina-dsh-panel iframe').locator('.typst-doc')).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => (await probe(parent, { action: 'catalog' })).filter((tool) => tool.name.startsWith('tylina_')).length).toBe(18)
  assert.equal(await readMain(), changed)
  await parent.screenshot({ path: join(root, `.benchmarks/dsh-${mode}-window-recovery.png`) })
  console.log(`PASS ${mode}: detached document and tools survive launcher reload/close, reconnect to the same conversation and return to the sidebar`)
  return parent
}
