import type { RequestHandler } from './$types'
import { json } from '@sveltejs/kit'
import { listWebhookDeliveries } from '$lib/server/agents/service'
import { jsonError } from '$lib/server/http/api-error'

export const GET: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) return jsonError('Unauthorized', 401)

  const deliveries = await listWebhookDeliveries(user.id)
  return json({ deliveries })
}
