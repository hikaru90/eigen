import type { PageServerLoad } from './$types'
import { error, redirect } from '@sveltejs/kit'
import { loadProjectDetail } from '$lib/server/memory/project-detail'
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone'
import {
  openQuestionsOf,
  toThreadThought,
  uniqueThoughts,
  type ThreadStanding,
  type ThreadThought,
} from '../thread-list'

/**
 * One thread (ei redesign, wave 3.2): the same server module
 * `/memory/projects/[entityId]` uses (loadProjectDetail,
 * src/lib/server/memory/project-detail.ts) — the promoted GTD project plus the
 * timeline items linked to it — folded into the detail's shape. Nothing about
 * the module changes; a hub that is not a listed project is a 404 here too.
 */

export type ThreadDetailPageData = {
  preferredTimezone: string
  entityId: string
  title: string
  standing: ThreadStanding
  questions: ThreadThought[]
  thoughts: ThreadThought[]
}

export const load: PageServerLoad = async (event) => {
  if (!event.locals.user) {
    throw redirect(302, '/login')
  }
  const userId = event.locals.user.id

  const entityId = event.params.id?.trim()
  if (!entityId) error(400, 'Thread id is required')

  event.depends('timeline:temporal-events', 'timeline:thoughts', `project:${entityId}`)

  let detail: Awaited<ReturnType<typeof loadProjectDetail>>
  try {
    detail = await loadProjectDetail(userId, entityId)
  } catch (err) {
    // validateNonEmptyEntityId rejects malformed ids — a bad request, not a crash
    error(400, err instanceof Error ? err.message : String(err))
  }
  if (!detail) error(404, 'Thread not found')

  const preferredTimezone = await getUserPreferredTimezone(userId)
  const { project, items } = detail

  return {
    user: event.locals.user,
    preferredTimezone,
    entityId: project.entityId,
    title: project.label,
    standing: {
      status: project.status,
      nextActionSummary: project.nextAction?.summary ?? null,
      openTaskCount: project.openTaskCount,
      targetDate: project.targetDate,
      stalledReason: project.stalled?.reason ?? null,
      milestones: project.milestones.map((milestone) => ({
        id: milestone.id,
        label: milestone.label,
        targetDate: milestone.targetDate,
        completedAt: milestone.completedAt,
      })),
    },
    questions: openQuestionsOf(items).map(toThreadThought),
    thoughts: uniqueThoughts(items).map(toThreadThought),
  } satisfies ThreadDetailPageData & { user: NonNullable<App.Locals['user']> }
}
