import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'

/** A Session created by API can have a cwd without the Workspace registration required by Harness's composer. */
export async function ensureHarnessWorkspace(ctx: Context, sessionId: SessionId): Promise<void> {
  if (ctx.workspaces.list.getSnapshot().items.some((workspace) => workspace.sessionIds.includes(sessionId))) return
  const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
  if (!cwd) throw new Error('The Harness session has no working directory')
  const workspace = await ctx.workspaces.create({ path: cwd })
  // The released create/adopt API attaches this existing identity without creating another conversation.
  await ctx.sessions.create({ sessionId, workspaceId: workspace.workspaceId })
}
