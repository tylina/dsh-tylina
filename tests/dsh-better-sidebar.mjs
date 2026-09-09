import assert from 'node:assert/strict'
import { join } from 'node:path'

/** Wait for the installed host's debounced layout write before testing restoration. */
export async function expectPersistedDocumentTab({ page, sessionId, expect }) {
  await expect.poll(() => page.evaluate((sessionId) => {
    const raw = localStorage.getItem(`dsh-sidebar:v1:${sessionId}`)
    if (!raw) return false
    const state = JSON.parse(raw)
    const activeDocument = (node) => node?.kind === 'leaf'
      ? node.tabs.some((tab) => tab.id === node.active && tab.type === 'dsh-tylina:document')
      : node?.children?.some(activeDocument) ?? false
    return state.panelOpen && activeDocument(state.splits)
  }, sessionId)).toBe(true)
}

/** Real installed Better Sidebar, not a substitute service. */
export async function verifyBetterSidebar({ page, frame, iframe, root, mode, expect, readMain, external, menu }) {
  await expect(page.locator('.tylina-dsh-panel')).toHaveClass(/tylina-dsh-panel-embedded/u)
  assert.equal(await page.locator('body').getAttribute('data-tylina-docked'), null, 'the host owns sidebar layout')
  await expect(page.locator('.tylina-dsh-bar .tylina-dsh-brand')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /^(打开 Web 编辑器|Open the Web editor)$/u })).toHaveAttribute('href', 'https://tylina.github.io/app/')
  const marker = `retained-${Date.now()}`
  await frame.locator('body').evaluate((body, marker) => { body.dataset.tylinaAcceptance = marker }, marker)
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: /^(隐藏编辑器|Hide editor)$/u }).click()
    await expect(iframe).toBeHidden()
    await page.getByRole('button', { name: /^(打开 Tylina|Open Tylina)$/u }).click()
    await expect(iframe).toBeVisible()
    await expect(frame.locator('body')).toHaveAttribute('data-tylina-acceptance', marker)
  }
  await menu('Edit', 'Undo')
  await expect.poll(readMain).not.toBe(external)
  await menu('Edit', 'Redo')
  await expect.poll(readMain).toBe(external)
  await expect(frame.locator('body')).toHaveAttribute('data-tylina-acceptance', marker)
  const panel = await page.locator('.tylina-dsh-panel').boundingBox()
  await page.mouse.move(panel.x, panel.y + 100)
  await page.mouse.down(); await page.mouse.move(panel.x - 180, panel.y + 100, { steps: 12 }); await page.mouse.up()
  await expect.poll(async () => (await page.locator('.tylina-dsh-panel').boundingBox()).width).toBeGreaterThan(panel.width + 100)
  await expect(frame.locator('body')).toHaveAttribute('data-tylina-acceptance', marker)
  await page.screenshot({ path: join(root, `.benchmarks/dsh-${mode}-better-sidebar.png`) })
}
