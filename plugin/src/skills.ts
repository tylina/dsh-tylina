import type { Context } from '@deepseek-ai/cordis'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import type {} from '@deepseek-ai/dsh-skill'

/** Harness owns discovery and frontmatter; every distribution copies the Desktop resource tree. */
export function registerTylinaSkills(ctx: Context, skillsRootPath: string): void {
  ctx.skills.registerProvider((control) => new FileSystemSkillProvider(ctx, control, {
    providerName: 'tylina', includeDefaultRoots: false, bundledSkillDir: skillsRootPath, watch: false
  }))
}
