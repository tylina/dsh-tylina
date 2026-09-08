import assert from 'node:assert/strict'
import { join } from 'node:path'

/** Keep a real editor save pending while reconnecting an actual installed Harness tool owner. */
export async function verifyToolReconnect(options) {
  for (const committed of [false, true]) await verifyReconnectPhase(options, committed)
}

async function verifyReconnectPhase({ page, frame, root, mode, readMain, probeRequest, editorSockets, expect, expectedMissing }, committed) {
  const original = await readMain()
  const toggleSplit = async () => {
    const button = frame.getByRole('button', { name: 'Split', exact: true })
    if (await button.isVisible()) await button.click()
    else {
      await frame.getByRole('button', { name: 'More', exact: true }).click()
      await frame.getByRole('menuitemcheckbox', { name: 'Split View', exact: true }).click()
    }
  }
  let releaseSave, saves = 0, reads = 0
  const cancelledFile = 'cancelled-tool.typ'
  expectedMissing.add(cancelledFile)
  const acceptedText = original + ' Accepted Agent edit.'
  const gate = new Promise((resolve) => { releaseSave = resolve })
  const routes = new Set(), routeErrors = []
  const holdSave = (route) => {
    const task = (async () => {
      if (route.request().method() === 'POST') { saves++; await gate }
      else if (!committed && new URL(route.request().url()).searchParams.has('read')) { reads++; await gate }
      await route.continue()
    })().catch((error) => { routeErrors.push(error.message) })
    routes.add(task)
    return task.finally(() => routes.delete(task))
  }
  const connections = editorSockets.length
  let result
  await page.route('**/tylina/project?**', holdSave)
  try {
    await toggleSplit()
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
    // Hold actual lazy admission so cancellation occurs before the canonical commit.
    // A pending save alone does not mean an already-loaded text edit is uncommitted.
    result = probeRequest({ name: 'tylina_write_file', input: {
      file: committed ? 'Plugin.typ' : cancelledFile,
      contents: committed ? acceptedText : 'This cancelled write must never be replayed.',
      expectedSha256: committed ? read.sha256 : null
    } })
    void result.catch(() => undefined)
    await entered
    if (committed) await expect(source).toContainText('Accepted Agent edit.')
    else await expect.poll(() => reads).toBeGreaterThan(0)
    await page.getByRole('button', { name: /^(重新连接 Agent 工具|Reconnect Agent tools)$/u }).click()
    const waiting = page.getByRole('button', { name: /^(正在重新连接 Agent 工具…|Reconnecting Agent tools…)$/u })
    if (committed) {
      await expect(waiting).toBeDisabled()
      await expect(waiting).toHaveAttribute('aria-busy', 'true')
    }
    await source.click({ position: { x: 150, y: 12 } })
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
    await page.keyboard.insertText(' Input stays responsive.')
    await expect(source).toContainText('Input stays responsive.')
    if (committed) assert.equal(editorSockets.length, connections,
      'a new socket cannot take ownership while the applied tool is still saving')
    await page.screenshot({ path: join(root, `.benchmarks/dsh-${mode}-tool-reconnect-${committed ? 'committed' : 'pending'}.png`) })
  } finally {
    releaseSave(); await Promise.allSettled([...routes]); await page.unroute('**/tylina/project?**', holdSave)
  }
  assert.deepEqual(routeErrors, [])
  assert.equal((await result).isError, true, 'the cancelled tool cannot report a successful edit')
  await expect(page.getByRole('button', { name: /^(重新连接 Agent 工具|Reconnect Agent tools)$/u })).toBeEnabled()
  assert.equal(editorSockets.length, connections + 1)
  await expect.poll(async () => (await probeRequest({ action: 'catalog' })).filter((tool) => tool.name === 'tylina').length).toBe(1)
  const current = (await probeRequest({ name: 'tylina_read_file', input: { file: 'Plugin.typ' } })).value.structuredContent
  assert.equal(current.text, (committed ? acceptedText : original + ' Pending user save.') + ' Input stays responsive.')
  assert.equal((await probeRequest({ name: 'tylina_read_file', input: { file: cancelledFile } })).isError, true,
    'a write cancelled during admission must not create canonical or persisted content')
  await expect.poll(readMain).toBe(current.text)
  assert.equal((await probeRequest({ name: 'tylina_write_file', input: {
    file: 'Plugin.typ', contents: original, expectedSha256: current.sha256
  } })).isError, false)
  await expect.poll(readMain).toBe(original)
  await toggleSplit()
  console.log(`PASS ${mode}: reconnect ${committed ? 'after' : 'before'} commit preserves typing and never replays the cancelled write`)
}
