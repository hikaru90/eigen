import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { dismissProject } from '$lib/server/memory/project-list'

export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const entityId = event.params.entityId?.trim()
  if (!entityId) error(400, 'Entity id is required')

  try {
    await dismissProject(user.id, entityId)
    return json({ ok: true, summary: 'Project dismissed.' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    error(400, message)
  }
}
