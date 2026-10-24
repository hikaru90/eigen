import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { markAllNotificationsRead } from '$lib/server/notifications/service'

/** POST: the list was seen — mark every unread notification read. */
export const POST: RequestHandler = async (event) => {
  if (!event.locals.user) error(401, 'Unauthorized')
  await markAllNotificationsRead(event.locals.user.id)
  return json({ ok: true })
}
