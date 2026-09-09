import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readEditorSource } from './dsh-source.mjs'

/** Reconnect the installed tool owner while a real canonical save is pending. */
export async function verifyToolReconnect({ page, frame, root, mode, readMain, probeRequest, editorSockets, expect }) {
  const original = await readMain()
  const call = (command, args = {}) => probeRequest({ name: 'tylina', input: { command, args } })
  const view = (await call('view.state')).value.structuredContent
  await call('view.set', { target: 'mode', value: 'split' })
  let releaseSave, saves = 0
  const gate = new Promise(resolve => { releaseSave = resolve })
  const routes = new Set(), routeErrors = []
  const holdSave = route => {
    const task = (async () => {
      if (route.request().method() === 'POST') { saves++; await gate }
      await route.continue()
    })().catch(error => { routeErrors.push(error.message) })
    routes.add(task)
    return task.finally(() => routes.delete(task))
  }
  const connections = editorSockets.length
  let result
  await page.route('**/tylina/project?**', holdSave)
  try {
    const source = frame.getByTestId('monaco-source-editor')
    await source.click({ position: { x: 150, y: 12 } })
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
    await page.keyboard.insertText(' Pending user save.')
    await expect.poll(() => saves).toBeGreaterThan(0)
    const entered = editorSockets.at(-1).waitForEvent('framereceived', {
      predicate: ({ payload }) => {
        const message = JSON.parse(String(payload))
        return message.kind === 'call' && message.name === 'tylina_save_workspace'
      }
    })
    result = call('workspace.save')
    void result.catch(() => undefined)
    await entered
    await page.getByRole('button', { name: /^(重新连接 Agent 工具|Reconnect Agent tools)$/u }).click()
    await source.click({ position: { x: 150, y: 12 } })
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
    await page.keyboard.insertText(' Input stays responsive.')
    await expect(source).toContainText('Input stays responsive.')
    await page.screenshot({ path: join(root, `.benchmarks/dsh-${mode}-tool-reconnect.png`) })
  } finally {
    releaseSave(); await Promise.allSettled([...routes]); await page.unroute('**/tylina/project?**', holdSave)
  }
  assert.deepEqual(routeErrors, [])
  assert.equal((await result).isError, true, 'a cancelled save cannot report success')
  await expect(page.getByRole('button', { name: /^(重新连接 Agent 工具|Reconnect Agent tools)$/u })).toBeEnabled()
  assert.equal(editorSockets.length, connections + 1)
  await expect.poll(async () => (await probeRequest({ action: 'catalog' })).filter(tool => tool.name === 'tylina').length).toBe(1)
  const text = original + ' Pending user save. Input stays responsive.'
  assert.equal((await readEditorSource(page, probeRequest)).text, text)
  await expect.poll(readMain).toBe(text)
  // Restore through the editor's history; a reconnect must not sever Undo.
  await frame.getByTestId('monaco-source-editor').click()
  for (let attempt = 0; attempt < 16 && await readMain() !== original; attempt++) {
    const beforeUndo = await readMain()
    await page.keyboard.press('ControlOrMeta+z')
    await call('workspace.save')
    await expect.poll(readMain).not.toBe(beforeUndo)
  }
  await expect.poll(readMain).toBe(original)
  await call('view.set', { target: 'mode', value: view.mode })
  console.log(`PASS ${mode}: reconnect during save preserves responsive typing, canonical content and Undo`)
}
