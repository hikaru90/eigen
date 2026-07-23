import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { setProjectMilestone } from '$lib/server/memory/project-timeline'

export type SetProjectMilestoneRequest = {
  label: string
  milestoneId?: string
  targetDate?: string | null
  linkedThoughtId?: string | null
  rank?: number
  completed?: boolean
}

export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const entityId = event.params.entityId?.trim()
  if (!entityId) error(400, 'Entity id is required')

  let body: SetProjectMilestoneRequest
  try {
    body = (await event.request.json()) as SetProjectMilestoneRequest
  } catch {
    error(400, 'Invalid JSON body')
  }

  const label = body.label?.trim()
  if (!label) error(400, 'label is required')

  try {
    const milestone = await setProjectMilestone({
      userId: user.id,
      projectEntityId: entityId,
      label,
      ...(body.milestoneId ? { milestoneId: body.milestoneId } : {}),
      ...(body.targetDate !== undefined ? { targetDate: body.targetDate } : {}),
      ...(body.linkedThoughtId !== undefined ? { linkedThoughtId: body.linkedThoughtId } : {}),
      ...(body.rank !== undefined ? { rank: body.rank } : {}),
      ...(body.completed !== undefined ? { completed: body.completed } : {}),
    })
    return json({ milestone })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    error(400, message)
  }
}
