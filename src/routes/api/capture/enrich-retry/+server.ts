import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { requeueEnrichThought } from '$lib/server/capture/queue-capture'

export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  let body: unknown
  try {
    body = await event.request.json()
  } catch {
    error(400, 'Invalid JSON')
  }

  const thoughtId =
    typeof body === 'object' && body && 'thoughtId' in body
      ? String((body as { thoughtId?: unknown }).thoughtId ?? '').trim()
      : ''
  if (!thoughtId) error(400, 'thoughtId is required')

  const result = await requeueEnrichThought(user.id, thoughtId)
  if (!result.ok) {
    if (result.reason === 'not_found') error(404, 'Thought not found')
    error(409, 'Thought is not eligible for enrich retry')
  }

  return json({ ok: true as const, thoughtId })
}
