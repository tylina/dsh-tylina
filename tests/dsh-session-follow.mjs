import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function verifySessionFollowing({ page, frame, home, probeRequest, readMain, external, expect }) {
  const cwd = join(home, 'second-project')
  await mkdir(cwd)
  const source = '= A separate conversation project\n'
  await writeFile(join(cwd, 'Second.typ'), source)
  const second = await probeRequest({ action: 'create-session', cwd })
  const open = page.getByRole('button', { name: /^(打开 Tylina|Open Tylina)$/u })
  const hide = page.getByRole('button', { name: /^(隐藏编辑器|Hide editor)$/u })
  await hide.click()
  // This session was created by another client (the host fixture), so refresh through the normal editor entry.
  await open.click()
  await hide.click()
  const ungrouped = page.getByRole('treeitem').filter({ has: page.getByText(/^(未分组|Ungrouped)$/u) })
  if (await ungrouped.getAttribute('aria-expanded') !== 'true') await ungrouped.click()
  await page.getByText('Conversation B', { exact: true }).click()
  await open.click()
  await expect(frame.getByTitle('Second.typ', { exact: true })).toBeVisible({ timeout: 30_000 })
  await frame.getByTitle('Second.typ', { exact: true }).dblclick()
  await expect(frame.locator('.web-document-title')).toHaveText('second-project')
  await expect(frame.locator('.typst-doc')).toBeVisible()
  const count = async (sessionId) => (await probeRequest({ action: 'catalog', ...(sessionId && { sessionId }) }))
    .filter((tool) => tool.name.startsWith('tylina_')).length
  await expect.poll(() => count(second.sessionId)).toBe(18)
  await expect.poll(() => count()).toBe(0)
  const info = (await probeRequest({ sessionId: second.sessionId, name: 'tylina_workspace_info' })).value.structuredContent
  assert.equal(info.root, cwd)
  await expect.poll(readMain).toBe(external)
  await hide.click()
  await page.getByRole('treeitem').getByText('Conversation A', { exact: true }).click()
  await open.click()
  await expect(frame.locator('.web-document-title')).toHaveText('project', { timeout: 30_000 })
  await expect(frame.locator('.typst-doc')).toBeVisible()
  await expect.poll(() => count()).toBe(18)
  await expect.poll(() => count(second.sessionId)).toBe(0)
  await expect.poll(readMain).toBe(external)
  assert.equal(await readFile(join(cwd, 'Second.typ'), 'utf8'), source)
}
