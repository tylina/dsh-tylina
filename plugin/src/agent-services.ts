import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

/** Agent scope and plugin dependency admission are separate Cordis boundaries. */
export async function withAgentServices<T>(agent: Agent, dependencies: string[], operation: (ctx: Context) => Promise<T>): Promise<T> {
  let pending: Promise<T> | undefined
  const owner = agent.ctx.inject(dependencies, (ctx) => {
    pending = Promise.resolve().then(() => operation(ctx))
    void pending.catch(() => undefined)
  })
  try {
    await owner
    if (!pending) throw new Error('The Harness Agent services are unavailable')
    return await pending
  } finally { await owner.dispose() }
}
