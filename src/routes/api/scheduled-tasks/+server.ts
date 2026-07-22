import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { listScheduledTasks } from '$lib/server/scheduled-tasks/service'

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) {
    error(401, 'Unauthorized')
  }

  try {
    const tasks = await listScheduledTasks(locals.user.id)
    return json({ tasks })
  } catch (err) {
    console.error('[scheduled-tasks] list failed', {
      message: err instanceof Error ? err.message : String(err),
    })
    return json(
      {
        tasks: [],
        error: err instanceof Error ? err.message : 'Failed to load scheduled tasks',
      },
      { status: 500 },
    )
  }
}
