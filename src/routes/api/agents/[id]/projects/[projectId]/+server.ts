import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { unbindAgentFromProject } from '$lib/server/agents/service'

export const DELETE: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await unbindAgentFromProject({
      userId: user.id,
      agentId: event.params.id,
      projectEntityId: event.params.projectId,
    })
    return json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status = message.includes('not found') ? 404 : 400
    return json({ error: message }, { status })
  }
}
