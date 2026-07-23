import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { setProjectDeadline } from '$lib/server/memory/project-timeline'

export type SetProjectDeadlineRequest = {
  targetDate: string | null
}

export type SetProjectDeadlineResponse = {
  projectEntityId: string
  targetDate: string | null
}

export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const entityId = event.params.entityId?.trim()
  if (!entityId) error(400, 'Entity id is required')

  let body: SetProjectDeadlineRequest
  try {
    body = (await event.request.json()) as SetProjectDeadlineRequest
  } catch {
    error(400, 'Invalid JSON body')
  }

  if (!('targetDate' in body)) error(400, 'targetDate is required (ISO-8601 or null)')

  try {
    const result = await setProjectDeadline({
      userId: user.id,
      projectEntityId: entityId,
      targetDate: body.targetDate,
    })
    return json(result satisfies SetProjectDeadlineResponse)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    error(400, message)
  }
}
