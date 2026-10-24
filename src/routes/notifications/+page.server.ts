import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'
import { listNotifications } from '$lib/server/notifications/service'

export const load: PageServerLoad = async (event) => {
  if (!event.locals.user) throw redirect(302, '/login')
  event.depends('app:notifications')
  return { notifications: await listNotifications(event.locals.user.id) }
}
