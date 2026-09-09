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
  const source = page.frameLocator('iframe').getByTestId('monaco-source-editor')
  await source.click({ position: { x: 150, y: 12 } })
  await page.keyboard.press('ControlOrMeta+a')
  const state = await call('editor.state')
  const text = state.selection?.text ?? ''
  await page.keyboard.press('ArrowRight')
  await call('view.set', { target: 'mode', value: view.mode })
  return { text }
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
