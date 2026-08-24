import type { PageServerLoad } from './$types'
import { error, redirect } from '@sveltejs/kit'
import { parseProjectViewMode } from '$lib/memory/project-view-mode'
import { loadProjectDetail } from '$lib/server/memory/project-detail'
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone'

export const load: PageServerLoad = async (event) => {
  if (!event.locals.user) {
    throw redirect(302, '/login')
  }

  const entityId = event.params.entityId?.trim()
  if (!entityId) error(400, 'Entity id is required')

  event.depends('timeline:temporal-events', 'timeline:thoughts', `project:${entityId}`)

  const detail = await loadProjectDetail(event.locals.user.id, entityId)
  if (!detail) error(404, 'Project not found')

  const view = parseProjectViewMode(event.url.searchParams.get('view'))
  const preferredTimezone = await getUserPreferredTimezone(event.locals.user.id)

  return {
    user: event.locals.user,
    preferredTimezone,
    view,
    project: detail.project,
    items: detail.items,
  }
}
