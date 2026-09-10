/** Real host filesystem edits, compiler mapping, animation and page reveal; no model service required. */
export async function verifyEditAnimation({ frame, expect, call, writeSource, screenshot }) {
  const source = '#set page(width: 600pt, height: 420pt)\n#let slide(body) = { pagebreak(weak: true); block(body) }\n#slide[= First page\nKeep this page.]\n#slide[= Second page\nKeep this too.]\n#slide[= Third page\nChange this sentence.]\n'
  const root = frame.getByTestId('tylina-root')
  for (const slides of [false, true]) {
    await call('view.set', { target: 'slides', value: false })
    await call('view.set', { target: 'mode', value: 'split' })
    await writeSource(source)
    await expect(frame.getByTestId('monaco-source-editor')).toContainText('Change this sentence.')
    await expect(root).toHaveAttribute('data-compile-status', 'success', { timeout: 30_000 })
    await call('view.set', { target: 'mode', value: 'document' })
    if (slides) await call('view.set', { target: 'slides', value: true })
    await expect(frame.getByTestId('external-edit-transition')).toHaveCount(0)
    const preview = frame.getByTestId('document-preview')
    await preview.evaluate((element) => {
      element.scrollTo({ top: 0 })
      window.animationProbe?.observer.disconnect()
      const state = { pages: [], highlights: 0, observer: null }
      state.observer = new MutationObserver(() => {
        for (const box of element.querySelectorAll('[data-testid="external-edit-transition-box"]')) {
          state.highlights++
          const index = box.closest('[data-page-index]')?.getAttribute('data-page-index')
          if (index && !state.pages.includes(index)) state.pages.push(index)
        }
      })
      state.observer.observe(element, { childList: true, subtree: true, attributes: true })
      window.animationProbe = state
    })
    await writeSource(source.replace('Change this sentence.', 'The Agent updated this sentence.'))
    await expect.poll(() => preview.evaluate(() => window.animationProbe.pages), { timeout: 20_000 }).toContain('2')
    await expect(frame.getByTestId('external-edit-transition')).toHaveCount(0, { timeout: 15_000 })
    await expect(root).toHaveAttribute('data-compile-status', 'success')
    await expect(frame.locator('.typstPage[data-page-index="2"]')).toBeInViewport()
    await expect(frame.getByTestId('external-edit-transition-box')).toHaveCount(0)
    const observed = await preview.evaluate(() => {
      window.animationProbe.observer.disconnect()
      return { pages: window.animationProbe.pages, highlights: window.animationProbe.highlights }
    })
    expect(observed.pages).toEqual(['2'])
    expect(observed.highlights).toBeGreaterThan(0)
    await screenshot(slides ? 'slides' : 'document')
  }
  await call('view.set', { target: 'slides', value: false })
}
