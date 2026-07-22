import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { listExternalBusyBlocks } from '$lib/server/calendar/external-calendar'

export const GET: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const rangeStartRaw = event.url.searchParams.get('rangeStart')
  const rangeEndRaw = event.url.searchParams.get('rangeEnd')
  if (!rangeStartRaw || !rangeEndRaw) {
    error(400, 'rangeStart and rangeEnd are required ISO timestamps')
  }

  const rangeStart = new Date(rangeStartRaw)
  const rangeEnd = new Date(rangeEndRaw)
  if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
    error(400, 'Invalid rangeStart or rangeEnd')
  }

  const blocks = await listExternalBusyBlocks({
    userId: user.id,
    rangeStart,
    rangeEnd,
  })

  return json({ blocks, synced: false })
}
