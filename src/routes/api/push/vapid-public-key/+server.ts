import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { readVapidConfigFromEnv } from '$lib/server/push/vapid'

export const GET: RequestHandler = async (event) => {
  if (!event.locals.user) error(401, 'Unauthorized')
  try {
    const { publicKey } = readVapidConfigFromEnv()
    return json({ publicKey })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    error(503, msg)
  }
}
