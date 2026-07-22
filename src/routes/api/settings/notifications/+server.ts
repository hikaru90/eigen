import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import {
  parseNotificationSettingsBody,
  saveNotificationSettings,
} from '$lib/server/settings/notification-settings'

export const PUT: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  let body: unknown
  try {
    body = await event.request.json()
  } catch {
    error(400, 'Expected JSON body')
  }

  let input
  try {
    input = parseNotificationSettingsBody(body)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    error(400, msg)
  }

  try {
    const saved = await saveNotificationSettings(user.id, input)
    return json(saved)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    error(500, msg)
  }
}
