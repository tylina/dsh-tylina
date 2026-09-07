import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(join(root, 'plugin/package.json'))
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
const { SkillRegistry } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-skill')).href)
const { registerTylinaSkills } = await import(new URL('../plugin/src/skills.ts', import.meta.url))

test('released Harness discovers all bundled domains and loads their exact bodies with disposable ownership', async () => {
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  const { assetsRoot } = await import('../source.mjs')
  const resources = join(assetsRoot, 'skills')
  const expected = (await readdir(resources)).filter((name) => name.startsWith('typst-')).sort()
  const owner = ctx.plugin({ inject: ['skills'], apply(ctx) { registerTylinaSkills(ctx, resources) } })
  await owner
  try {
    const skills = await ctx.skills.list()
    assert.deepEqual(skills.map((skill) => skill.name).sort(), expected)
    for (const summary of skills) {
      assert.equal(summary.provider, 'tylina')
      assert.equal(summary.source, 'bundled')
      const skill = await ctx.skills.get(summary.name)
      assert.equal(skill.path, join(resources, summary.name, 'SKILL.md'))
      assert.deepEqual(skill.resourceBase, { kind: 'directory', path: join(resources, summary.name) })
      assert.ok((await readFile(skill.path, 'utf8')).includes(skill.content))
      assert.ok(skill.content.length > 100)
    }
    await owner.dispose()
    assert.deepEqual(await ctx.skills.list(), [])
  } finally { await ctx.fiber.dispose() }
})
