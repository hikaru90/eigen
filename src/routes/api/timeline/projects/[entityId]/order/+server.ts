import { error, json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { orderTaskInProject } from '$lib/server/memory/project-task-sequence'

export type OrderProjectTaskRequest = {
  thoughtId: string
  afterThoughtId?: string | null
  rank?: number
  /** When true, also designate this thought as the project next action. */
  asNextAction?: boolean
}

export type OrderProjectTaskResponse = {
  projectEntityId: string
  orderedThoughtIds: string[]
}

export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const entityId = event.params.entityId?.trim()
  if (!entityId) error(400, 'Entity id is required')

  let body: OrderProjectTaskRequest
  try {
    body = (await event.request.json()) as OrderProjectTaskRequest
  } catch {
    error(400, 'Invalid JSON body')
  }

  const thoughtId = body.thoughtId?.trim()
  if (!thoughtId) error(400, 'thoughtId is required')

  try {
    const result = await orderTaskInProject({
      userId: user.id,
      projectEntityId: entityId,
      thoughtId,
      afterThoughtId: body.afterThoughtId,
      rank: body.rank,
    })
    if (body.asNextAction === true) {
      const { designateNextAction } = await import('$lib/server/memory/project-next-action')
      await designateNextAction(user.id, entityId, thoughtId)
    }
    return json(result satisfies OrderProjectTaskResponse)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    error(400, message)
  }
}
