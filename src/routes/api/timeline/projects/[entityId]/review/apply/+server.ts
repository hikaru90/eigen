import type { RequestHandler } from './$types'
import { error, json } from '@sveltejs/kit'
import type {
  ApplyProjectReviewRequest,
  ApplyProjectReviewResponse,
} from '$lib/memory/project-review-types'
import type { TemporalEventKind } from '$lib/server/db/brain.schema'
import {
  applyProjectReview,
  type ApplyProjectReviewInput,
} from '$lib/server/memory/project-review'

export type { ApplyProjectReviewRequest, ApplyProjectReviewResponse }

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
}

export const POST: RequestHandler = async (event) => {
  const user = event.locals.user
  if (!user) error(401, 'Unauthorized')

  const entityId = event.params.entityId?.trim()
  if (!entityId) error(400, 'Entity id is required')

  let body: ApplyProjectReviewRequest = {}
  try {
    const text = await event.request.text()
    if (text.trim()) {
      body = JSON.parse(text) as ApplyProjectReviewRequest
    }
  } catch {
    error(400, 'Invalid JSON body')
  }

  const allowedThoughtIds = asStringArray(body.allowedThoughtIds)
  if (
    allowedThoughtIds.length === 0 &&
    (body.markDone?.length || body.archive?.length || body.order?.length)
  ) {
    error(400, 'allowedThoughtIds is required when mutating existing tasks')
  }

  const deadlines = Array.isArray(body.deadlines)
    ? body.deadlines.filter(
        (d): d is { thoughtId: string; targetDate: string } =>
          !!d &&
          typeof d === 'object' &&
          typeof d.thoughtId === 'string' &&
          typeof d.targetDate === 'string',
      )
    : []

  const newTasks = Array.isArray(body.newTasks)
    ? body.newTasks
        .filter((t): t is NonNullable<typeof t> => !!t && typeof t === 'object')
        .map((t) => ({
          summary: typeof t.summary === 'string' ? t.summary : '',
          kind: (t.kind ?? null) as TemporalEventKind | null,
          suggestedStartAt:
            typeof t.suggestedStartAt === 'string' ? t.suggestedStartAt : null,
          suggestedEndAt: typeof t.suggestedEndAt === 'string' ? t.suggestedEndAt : null,
        }))
        .filter((t) => t.summary.trim().length > 0)
    : []

  const input: ApplyProjectReviewInput = {
    userId: user.id,
    projectEntityId: entityId,
    markDone: asStringArray(body.markDone),
    archive: asStringArray(body.archive),
    deadlines,
    order: asStringArray(body.order),
    ...(Object.prototype.hasOwnProperty.call(body, 'projectDeadline')
      ? { projectDeadline: body.projectDeadline ?? null }
      : {}),
    newTasks,
    nextActionThoughtId:
      typeof body.nextActionThoughtId === 'string' && body.nextActionThoughtId.trim()
        ? body.nextActionThoughtId.trim()
        : null,
    nextActionNewTaskIndex:
      typeof body.nextActionNewTaskIndex === 'number' ? body.nextActionNewTaskIndex : null,
    allowedThoughtIds,
  }

  try {
    const result = await applyProjectReview(input)
    return json(result satisfies ApplyProjectReviewResponse)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/not found/i.test(message)) error(404, message)
    if (/unknown thought/i.test(message)) error(400, message)
    error(400, message)
  }
}
