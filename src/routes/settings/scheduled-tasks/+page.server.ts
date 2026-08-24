import type { PageServerLoad } from './$types'
import { redirect } from '@sveltejs/kit'
import { listScheduledTasks } from '$lib/server/scheduled-tasks/service'

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    throw redirect(302, '/login')
  }

  try {
    const tasks = await listScheduledTasks(locals.user.id)
    return { tasks }
  } catch (err) {
    return {
      tasks: [],
      loadError: err instanceof Error ? err.message : 'Failed to load scheduled tasks',
    }
  }
}
