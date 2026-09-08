import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

export async function verifyLiveModel({ page, frame, project, readMain, probeRequest, expect, errors, expectedMissing }) {
  assert.deepEqual(errors, [], 'the editor must be healthy before the real model task')
  const before = await readMain()
  const selected = 'Continued after compaction.'
  const replacement = 'Real DSH selection verified.'
  const offset = before.indexOf(selected)
  assert.ok(offset >= 0)
  assert.equal(before.indexOf(selected, offset + 1), -1)
  await probeRequest({ name: 'tylina', input: { command: 'view.set', args: { target: 'mode', value: 'split' } } })
  await frame.getByTestId('monaco-source-editor').click({ position: { x: 100, y: 12 } })
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home')
  // Monaco treats a CRLF line ending as one cursor step.
  for (const _ of Array.from(before.slice(0, offset).replaceAll('\r\n', '\n'))) await page.keyboard.press('ArrowRight')
  for (const _ of selected) await page.keyboard.press('Shift+ArrowRight')
  const state = (await probeRequest({ name: 'tylina', input: { command: 'editor.state' } })).value.structuredContent
  assert.equal(state.selection.text, selected)
  assert.deepEqual(errors, [], 'keyboard selection must not produce editor errors')
  await page.locator('.tylina-dsh-panel').getByRole('button').first().focus()
  await probeRequest({ action: 'live-turn', prompt:
    'Read my current editor selection with Tylina editor.state. Replace only the selected text with "Real DSH selection verified." using file.edit; preserve all other bytes. Validate and save the document. Export PDF to output/RealAgent.pdf, PNG pages into output/png and SVG pages into output/svg. Use only the single Tylina tool for these document operations; discover its commands with help if needed. Do not modify other files. Keep the final response short.' })
  await expect.poll(async () => {
    const current = await probeRequest({ action: 'live-state' })
    if (current.errors.length) throw new Error(JSON.stringify(current.errors))
    return current.replied && current.status === 'idle'
  }, { timeout: 240_000 }).toBe(true)
  const final = await probeRequest({ action: 'live-state' })
  for (const command of ['editor.state', 'file.edit', 'document.validate', 'document.export']) {
    assert.ok(final.commands.includes(command), `The real model must execute ${command}`)
  }
  await expect.poll(readMain).toBe(before.slice(0, offset) + replacement + before.slice(offset + selected.length))
  assert.equal((await readFile(join(project, 'output/RealAgent.pdf'))).subarray(0, 5).toString(), '%PDF-')
  expectedMissing.add('output/RealAgent.pdf')
  for (const format of ['png', 'svg']) {
    const directory = join(project, 'output', format)
    const files = await readdir(directory, { withFileTypes: true })
    assert.equal(files.length, 1, 'the short test document exports one real page')
    assert.ok(files[0].isFile() && files[0].name.endsWith(`.${format}`))
    expectedMissing.add(['output', format, files[0].name].join('/'))
    const bytes = await readFile(join(directory, files[0].name))
    if (format === 'png') assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    else assert.ok(bytes.toString().includes('<svg'))
  }
  console.log('PASS: real DSH DeepSeek reads the human selection, edits its exact range, validates, saves and exports PDF/PNG/SVG through one Tylina tool')
}
