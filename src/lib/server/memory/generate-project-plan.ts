import { and, eq } from 'drizzle-orm'
import { captureThought } from '$lib/server/capture/service'
import { getDb } from '$lib/server/db'
import { thought } from '$lib/server/db/schema'
import {
  extractProjectTimeline,
  type ProjectTimelineExtraction,
  type ProjectTimelineTask,
} from '$lib/server/memory/extract-project-timeline'
import { listProjectsByEntityIds } from '$lib/server/memory/project-list'
import { designateNextAction, linkThoughtToProject } from '$lib/server/memory/project-next-action'
import { orderTaskInProject } from '$lib/server/memory/project-task-sequence'
import {
  loadExistingDeadlinesForProject,
  loadLinkedThoughtSummariesForProject,
  persistProjectTimelineExtraction,
} from '$lib/server/memory/project-timeline'
import { syncTemporalEventsFromThought } from '$lib/server/memory/temporal-graph-sync'
import type { ExtractedTemporalMention } from '$lib/server/memory/temporal-normalize'
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone'
import { ensureUserOntologySeeded, loadOntologyForUser } from '$lib/server/ontology-db'
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args'

export type GeneratedProjectPlanTask = {
  thoughtId: string
  summary: string
  rank: number
  isNextAction: boolean
  suggestedStartAt: string | null
  suggestedEndAt: string | null
}

export type GenerateProjectPlanResult = {
  projectEntityId: string
  projectLabel: string
  targetDate: string | null
  milestones: ProjectTimelineExtraction['milestones']
  tasks: GeneratedProjectPlanTask[]
}

function mentionFromTask(
  task: ProjectTimelineTask,
  timezone: string,
): ExtractedTemporalMention | null {
  if (!task.suggestedStartAt) return null
  return {
    surface: task.summary,
    kind: task.kind ?? 'deadline',
    startAt: task.suggestedStartAt,
    ...(task.suggestedEndAt ? { endAt: task.suggestedEndAt } : {}),
    timePrecision: 'day',
    timezone,
    isAllDay: true,
    confidence: 0.9,
    semanticSummary: task.summary,
  }
}

async function markThoughtAsTask(userId: string, thoughtId: string): Promise<void> {
  await ensureUserOntologySeeded(getDb(), userId)
  const loaded = await loadOntologyForUser(getDb(), userId)
  const kind = loaded.entityKindsByKey.get('task')
  if (!kind) {
    throw new Error('generateProjectPlan: ontology is missing the task category')
  }
  await getDb()
    .update(thought)
    .set({
      category: 'task',
      ontologyEntityKindId: kind.id,
      updatedAt: new Date(),
    })
    .where(and(eq(thought.userId, userId), eq(thought.id, thoughtId)))
}

export async function generateProjectPlan(input: {
  userId: string
  projectEntityId: string
  goal?: string
}): Promise<GenerateProjectPlanResult> {
  const entityId = validateNonEmptyEntityId(input.projectEntityId, 'projectEntityId')
  const [project] = await listProjectsByEntityIds(input.userId, [entityId])
  if (!project) {
    throw new Error('generateProjectPlan: GTD project not found for user')
  }

  const [linkedThoughts, existingDeadlines, timezone] = await Promise.all([
    loadLinkedThoughtSummariesForProject(input.userId, entityId),
    loadExistingDeadlinesForProject(input.userId, entityId),
    getUserPreferredTimezone(input.userId),
  ])

  const extraction = await extractProjectTimeline({
    userId: input.userId,
    projectLabel: project.label,
    linkedThoughts,
    existingDeadlines,
    ...(input.goal?.trim() ? { goal: input.goal.trim() } : {}),
  })

  const createdTasks: GeneratedProjectPlanTask[] = []
  let nextActionThoughtId: string | null = null

  for (let index = 0; index < extraction.tasks.length; index++) {
    const planned = extraction.tasks[index]!
    const captured = await captureThought(input.userId, planned.summary, { source: 'api' })
    const thoughtId = captured.id
    await markThoughtAsTask(input.userId, thoughtId)
    await linkThoughtToProject(input.userId, entityId, thoughtId, 'manual')
    await orderTaskInProject({
      userId: input.userId,
      projectEntityId: entityId,
      thoughtId,
      rank: index + 1,
    })

    const mention = mentionFromTask(planned, timezone)
    if (mention) {
      await syncTemporalEventsFromThought({
        userId: input.userId,
        thoughtId,
        normalizedText: planned.summary,
        precomputedMentions: [mention],
      })
    }

    if (planned.isNextAction && !nextActionThoughtId) {
      nextActionThoughtId = thoughtId
    }

    createdTasks.push({
      thoughtId,
      summary: planned.summary,
      rank: index + 1,
      isNextAction: planned.isNextAction,
      suggestedStartAt: planned.suggestedStartAt,
      suggestedEndAt: planned.suggestedEndAt,
    })
  }

  if (!nextActionThoughtId && createdTasks[0]) {
    nextActionThoughtId = createdTasks[0].thoughtId
    createdTasks[0] = { ...createdTasks[0], isNextAction: true }
  }
  if (nextActionThoughtId) {
    await designateNextAction(input.userId, entityId, nextActionThoughtId)
  }

  await persistProjectTimelineExtraction({
    userId: input.userId,
    projectEntityId: entityId,
    extraction: {
      targetDate: extraction.targetDate,
      milestones: extraction.milestones,
      tasks: extraction.tasks,
    },
  })

  return {
    projectEntityId: entityId,
    projectLabel: project.label,
    targetDate: extraction.targetDate,
    milestones: extraction.milestones,
    tasks: createdTasks,
  }
}
