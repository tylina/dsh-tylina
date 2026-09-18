import assert from 'node:assert/strict'

/** Observe canonical, possibly unsaved source through the actual selection API. */
export async function readEditorSource(page, probe) {
  const call = async (command, args = {}) => {
    const reply = await probe({ name: 'tylina', input: { command, args } })
    assert.equal(reply.isError, false, JSON.stringify(reply))
    return reply.value.structuredContent
  }
  const view = await call('view.state')
  await call('view.set', { target: 'mode', value: 'split' })
  const frame = page.frameLocator('iframe')
  const root = frame.getByTestId('tylina-root')
  const sidebarWasOpen = await root.getAttribute('data-workspace-sidebar-collapsed') !== 'true'
  if (sidebarWasOpen) await frame.getByRole('button', { name: 'Sidebar', exact: true }).click()
  try {
    const source = frame.getByTestId('monaco-source-editor')
    await source.click({ position: { x: 20, y: 12 } })
    await page.keyboard.press('ControlOrMeta+a')
    const state = await call('editor.state')
    return { text: state.selection?.text ?? '' }
  } finally {
    await page.keyboard.press('ArrowRight')
    if (sidebarWasOpen) await frame.getByRole('button', { name: 'Sidebar', exact: true }).click()
    await call('view.set', { target: 'mode', value: view.mode })
  }
}

/** Keep one Source view open while waiting so polling cannot cancel the workspace refresh it observes. */
export async function waitForEditorSource(page, probe, expected, expect, timeout = 20_000) {
  const call = async (command, args = {}) => {
    const reply = await probe({ name: 'tylina', input: { command, args } })
    assert.equal(reply.isError, false, JSON.stringify(reply))
    return reply.value.structuredContent
  }
  const view = await call('view.state')
  await call('view.set', { target: 'mode', value: 'split' })
  const frame = page.frameLocator('iframe')
  const root = frame.getByTestId('tylina-root')
  const sidebarWasOpen = await root.getAttribute('data-workspace-sidebar-collapsed') !== 'true'
  if (sidebarWasOpen) await frame.getByRole('button', { name: 'Sidebar', exact: true }).click()
  const source = frame.getByTestId('monaco-source-editor')
  let observed = ''
  let observedState
  try {
    try {
      await expect.poll(async () => {
        await source.click({ position: { x: 20, y: 12 } })
        await page.keyboard.press('ControlOrMeta+a')
        observedState = await call('editor.state')
        observed = observedState.selection?.text ?? ''
        return observed
      }, { timeout }).toBe(expected)
    } catch (error) {
      throw new Error(`Editor source did not settle. Expected ${JSON.stringify(expected)}, ` +
        `observed ${JSON.stringify(observed)} in ${JSON.stringify(observedState)}`, { cause: error })
    }
  } finally {
    await page.keyboard.press('ArrowRight')
    if (sidebarWasOpen) await frame.getByRole('button', { name: 'Sidebar', exact: true }).click()
    await call('view.set', { target: 'mode', value: view.mode })
  }
}

/** The real Harness owns disk reads/edits; Tylina receives them as external changes. */
export async function writeHarnessSource(probe, contents) {
  const info = await probe({ name: 'tylina', input: { command: 'workspace.info' } })
  assert.equal(info.isError, false, JSON.stringify(info))
  const file = 'Plugin.typ'
  const read = await probe({ name: 'read', input: { file_path: file } })
  assert.equal(read.isError, false, JSON.stringify(read))
  const written = await probe({ name: 'write', input: { file_path: file, content: contents } })
  assert.equal(written.isError, false, JSON.stringify(written))
}
