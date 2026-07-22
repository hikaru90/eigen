import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { loadNotificationStatusForUser } from '$lib/server/settings/notification-status'

export const GET: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const status = await loadNotificationStatusForUser(user.id)
  return json({ ok: true, ...status })
}
