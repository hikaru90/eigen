import type { PageServerLoad } from './$types'
import { error, redirect } from '@sveltejs/kit'
import { getDb } from '$lib/server/db'
import { listProjectsByEntityIds } from '$lib/server/memory/project-list'
import { loadYarnThoughts } from '$lib/server/mesh/yarn-list'
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args'
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone'
import { loadThoughtKindOptions } from '$lib/server/thought/kind-options'
import type { ThoughtKindOption } from '$lib/thought/kind-option'
import {
  QUESTION_CATEGORY,
  toThreadThought,
  type ThreadStanding,
  type ThreadThought,
} from '../thread-list'

/**
 * One thread (ei redesign, wave 3.2): the promoted GTD project (where it stands)
 * plus every thought on it. The thoughts are read from thread membership — the
 * same reader and membership rule as Yarn (loadYarnThoughts) — so a decision,
 * idea or question on a thread is listed here, not only its tasks (board
 * b6f74d02: the timeline's task/event items left everything else off). A hub
 * that is not a listed project is a 404.
 */

export type ThreadDetailPageData = {
  preferredTimezone: string
  entityId: string
  title: string
  standing: ThreadStanding
  questions: ThreadThought[]
  thoughts: ThreadThought[]
  /** The type menu in an unfolded row. */
  kinds: ThoughtKindOption[]
}

export const load: PageServerLoad = async (event) => {
  if (!event.locals.user) {
    throw redirect(302, '/login')
  }
  const userId = event.locals.user.id

  const entityId = event.params.id?.trim()
  if (!entityId) error(400, 'Thread id is required')

  event.depends('timeline:temporal-events', 'timeline:thoughts', `project:${entityId}`)

  let threadId: string
  try {
    threadId = validateNonEmptyEntityId(entityId, 'projectEntityId')
  } catch (err) {
    // malformed ids are a bad request, not a crash
    error(400, err instanceof Error ? err.message : String(err))
  }
  const [project] = await listProjectsByEntityIds(userId, [threadId])
  if (!project) error(404, 'Thread not found')

  // every thought on the thread, as Yarn reads them (one row per thought, newest first)
  const items = (await loadYarnThoughts(userId, { author: 'all', threadEntityId: threadId })).map(
    (row) => ({
      thoughtId: row.id,
      thoughtText: row.text,
      createdAt: row.createdAtIso,
      thoughtCategory: row.category,
      thoughtStatus: row.status,
    }),
  )

  const preferredTimezone = await getUserPreferredTimezone(userId)
  const kinds = await loadThoughtKindOptions(getDb(), userId)

  return {
    user: event.locals.user,
    preferredTimezone,
    kinds,
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
    questions: items
      .filter((item) => item.thoughtCategory === QUESTION_CATEGORY && item.thoughtStatus === 'open')
      .map(toThreadThought),
    thoughts: items.map(toThreadThought),
  } satisfies ThreadDetailPageData & { user: NonNullable<App.Locals['user']> }
}
