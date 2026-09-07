import assert from 'node:assert/strict'
import { join } from 'node:path'

/** Keep a real editor save pending while reconnecting an actual installed Harness tool owner. */
export async function verifyToolReconnect({ page, frame, root, mode, readMain, probeRequest, editorSockets, expect }) {
  const original = await readMain()
  let releaseSave, saves = 0
  const gate = new Promise((resolve) => { releaseSave = resolve })
  const routes = new Set(), routeErrors = []
  const holdSave = (route) => {
    const task = (async () => {
      if (route.request().method() === 'POST') { saves++; await gate }
      await route.continue()
    })().catch((error) => { routeErrors.push(error.message) })
    routes.add(task)
    return task.finally(() => routes.delete(task))
  }
  const connections = editorSockets.length
  let result
  await page.route('**/tylina/project?**', holdSave)
  try {
    await frame.getByRole('button', { name: 'Split', exact: true }).click()
    const source = frame.getByTestId('monaco-source-editor')
    await source.click({ position: { x: 150, y: 12 } })
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
    await page.keyboard.insertText(' Pending user save.')
    await expect.poll(() => saves).toBeGreaterThan(0)
    const read = (await probeRequest({ name: 'tylina_read_file', input: { file: 'Plugin.typ' } })).value.structuredContent
    assert.equal(read.text, original + ' Pending user save.')
    const entered = editorSockets.at(-1).waitForEvent('framereceived', {
      predicate: ({ payload }) => {
        const message = JSON.parse(String(payload))
        return message.kind === 'call' && message.name === 'tylina_write_file'
      }
    })
    result = probeRequest({ name: 'tylina_write_file', input: {
      file: 'Plugin.typ', contents: original + ' This cancelled write must never be replayed.', expectedSha256: read.sha256
    } })
    void result.catch(() => undefined)
    await entered
    await page.getByRole('button', { name: /^(重新连接 Agent 工具|Reconnect Agent tools)$/u }).click()
    const waiting = page.getByRole('button', { name: /^(正在重新连接 Agent 工具…|Reconnecting Agent tools…)$/u })
    await expect(waiting).toBeDisabled()
    await expect(waiting).toHaveAttribute('aria-busy', 'true')
    await source.click({ position: { x: 150, y: 12 } })
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
    await page.keyboard.insertText(' Input stays responsive.')
    await expect(source).toContainText('Input stays responsive.')
    assert.equal(editorSockets.length, connections, 'a new socket cannot take ownership before the old save and call settle')
    await page.screenshot({ path: join(root, `.benchmarks/dsh-${mode}-tool-reconnect.png`) })
  } finally {
    releaseSave(); await Promise.allSettled([...routes]); await page.unroute('**/tylina/project?**', holdSave)
  }
  assert.deepEqual(routeErrors, [])
  assert.equal((await result).isError, true, 'the cancelled tool cannot report a successful edit')
  await expect(page.getByRole('button', { name: /^(重新连接 Agent 工具|Reconnect Agent tools)$/u })).toBeEnabled()
  assert.equal(editorSockets.length, connections + 1)
  await expect.poll(async () => (await probeRequest({ action: 'catalog' })).filter((tool) => tool.name.startsWith('tylina_')).length).toBe(18)
  const current = (await probeRequest({ name: 'tylina_read_file', input: { file: 'Plugin.typ' } })).value.structuredContent
  assert.equal(current.text, original + ' Pending user save. Input stays responsive.')
  await expect.poll(readMain).toBe(current.text)
  assert.equal((await probeRequest({ name: 'tylina_write_file', input: {
    file: 'Plugin.typ', contents: original, expectedSha256: current.sha256
  } })).isError, false)
  await expect.poll(readMain).toBe(original)
  await frame.getByRole('button', { name: 'Split', exact: true }).click()
  console.log(`PASS ${mode}: explicit tool reconnect waits for active saves and calls, preserves typing and never replays the cancelled write`)
}
