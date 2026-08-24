import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'

export const load: PageServerLoad = async (event) => {
  const eventId = event.url.searchParams.get('event')
  const qs = eventId ? `?event=${encodeURIComponent(eventId)}` : ''
  throw redirect(302, `/memory/tasks${qs}`)
}
