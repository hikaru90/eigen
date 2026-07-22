import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { archiveTemporalEventForUser } from '$lib/server/memory/temporal-event-service'

export const DELETE: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const eventId = event.params.id?.trim()
  if (!eventId) error(400, 'Event id is required')

  try {
    const result = await archiveTemporalEventForUser(user.id, eventId)
    return json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('not found')) error(404, message)
    error(400, message)
  }
}
