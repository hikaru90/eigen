import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { reviewProject } from '$lib/server/memory/project-review'
import type { ReviewProjectResponse } from '$lib/memory/project-review-types'

export type { ReviewProjectResponse }

export type ReviewProjectRequest = {
  goal?: string
}

export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const entityId = event.params.entityId?.trim()
  if (!entityId) error(400, 'Entity id is required')

  let body: ReviewProjectRequest = {}
  try {
    const text = await event.request.text()
    if (text.trim()) {
      body = JSON.parse(text) as ReviewProjectRequest
    }
  } catch {
    error(400, 'Invalid JSON body')
  }

  try {
    const result = await reviewProject({
      userId: user.id,
      projectEntityId: entityId,
      ...(typeof body.goal === 'string' && body.goal.trim() ? { goal: body.goal.trim() } : {}),
    })
    return json(result satisfies ReviewProjectResponse)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/not found/i.test(message)) error(404, message)
    error(400, message)
  }
}
