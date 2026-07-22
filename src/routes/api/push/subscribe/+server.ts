import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import {
  parsePushSubscriptionBody,
  PUSH_SUBSCRIBE_USER_ERROR,
  upsertPushSubscription,
} from '$lib/server/push/subscription'

export const POST: RequestHandler = async (event) => {
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
    input = parsePushSubscriptionBody(body)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    error(400, msg)
  }

  const userAgent = event.request.headers.get('user-agent')

  try {
    const row = await upsertPushSubscription(user.id, input, userAgent)
    return json({ ok: true as const, id: row.id })
  } catch (e) {
    console.error('[push/subscribe] persist failed', {
      userId: user.id,
      message: e instanceof Error ? e.message : String(e),
    })
    error(500, PUSH_SUBSCRIBE_USER_ERROR)
  }
}
