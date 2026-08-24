import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import { syncAndScheduleCaptureEnrichQueue } from '$lib/server/capture/sync-capture-enrich-queue'

export const GET: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const { activeThoughtIds } = await syncAndScheduleCaptureEnrichQueue(user.id)
  return json({ thoughtIds: activeThoughtIds })
}
