import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { listAgentTaskAssignments } from '$lib/server/agents/service'

export const GET: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) return json({ error: 'Unauthorized' }, { status: 401 })

  const assignments = await listAgentTaskAssignments(user.id)
  return json({ assignments })
}
