import { and, eq, inArray } from 'drizzle-orm'
import { captureThought } from '$lib/server/capture/service'
import { getDb } from '$lib/server/db'
import { thought, type LifecycleStatus } from '$lib/server/db/schema'
import { decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import {
  extractProjectReview,
  type ProjectReviewExtraction,
  type ProjectReviewTaskInput,
} from '$lib/server/memory/extract-project-review'
import { setThoughtLifecycleStatus } from '$lib/server/memory/lifecycle'
import { listProjectsByEntityIds } from '$lib/server/memory/project-list'
import {
  clearNextActionIfCompleted,
  designateNextAction,
  linkThoughtToProject,
} from '$lib/server/memory/project-next-action'
import {
  loadOrderedThoughtIdsForProject,
  replaceProjectTaskSequence,
} from '$lib/server/memory/project-task-sequence'
import {
  loadExistingDeadlinesForProject,
  loadLinkedThoughtSummariesForProject,
  setProjectDeadline,
} from '$lib/server/memory/project-timeline'
import { syncTemporalEventsFromThought } from '$lib/server/memory/temporal-graph-sync'
import type { ExtractedTemporalMention } from '$lib/server/memory/temporal-normalize'
import { thoughtStatusFromMetadata } from '$lib/server/memory/project-eligibility'
import { getUserPreferredTimezone } from '$lib/server/memory/user-timezone'
import { ensureUserOntologySeeded, loadOntologyForUser } from '$lib/server/ontology-db'
import { validateNonEmptyEntityId } from '$lib/server/validation/mcp-args'
import type { TemporalEventKind } from '$lib/server/db/brain.schema'

export type ProjectReviewTaskStatus = 'open' | 'done' | 'archived'

export type ProjectTaskReviewInputBundle = {
  projectEntityId: string
  projectLabel: string
  projectStatus: string
  projectDeadline: string | null
  tasks: ProjectReviewTaskInput[]
  linkedThoughts: Array<{ thoughtId: string; summary: string }>
  allowedThoughtIds: string[]
}

export type ReviewProjectResult = {
  projectEntityId: string
  projectLabel: string
  projectDeadline: string | null
  tasks: ProjectReviewTaskInput[]
  linkedThoughts: Array<{ thoughtId: string; summary: string }>
  allowedThoughtIds: string[]
  review: ProjectReviewExtraction
}

export type ApplyProjectReviewNewTask = {
  summary: string
  kind: TemporalEventKind | null
  suggestedStartAt: string | null
  suggestedEndAt: string | null
}

export type ApplyProjectReviewInput = {
  userId: string
  projectEntityId: string
  markDone: string[]
  archive: string[]
  deadlines: Array<{ thoughtId: string; targetDate: string }>
  order: string[]
  /** When omitted, the project deadline is left unchanged. */
  projectDeadline?: string | null
  newTasks: ApplyProjectReviewNewTask[]
  nextActionThoughtId: string | null
  nextActionNewTaskIndex: number | null
  allowedThoughtIds: string[]
}

export type ApplyProjectReviewResult = {
  projectEntityId: string
  createdThoughtIds: string[]
  nextActionThoughtId: string | null
}

export function resolveProjectReviewTaskStatus(
  lifecycleStatus: LifecycleStatus | string,
  metadata: Record<string, unknown>,
): ProjectReviewTaskStatus {
  if (lifecycleStatus === 'archived') return 'archived'
  if (lifecycleStatus === 'completed') return 'done'
  if (thoughtStatusFromMetadata(metadata) === 'completed') return 'done'
  return 'open'
}

async function markThoughtAsTask(userId: string, thoughtId: string): Promise<void> {
  await ensureUserOntologySeeded(getDb(), userId)
  const loaded = await loadOntologyForUser(getDb(), userId)
  const kind = loaded.entityKindsByKey.get('task')
  if (!kind) {
    throw new Error('applyProjectReview: ontology is missing the task category')
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

function mentionFromDeadline(
  summary: string,
  startAt: string,
  timezone: string,
  kind: TemporalEventKind | null,
): ExtractedTemporalMention {
  return {
    surface: summary,
    kind: kind ?? 'deadline',
    startAt,
    timePrecision: 'day',
    timezone,
    isAllDay: true,
    confidence: 0.9,
    semanticSummary: summary,
  }
}

function assertKnownThoughtIds(ids: string[], allowed: Set<string>, field: string): void {
  for (const raw of ids) {
    const id = validateNonEmptyEntityId(raw, field)
    if (!allowed.has(id)) {
      throw new Error(`applyProjectReview: unknown thought id in ${field}: ${id}`)
    }
  }
}

export async function loadProjectTaskReviewInput(
  userId: string,
  projectEntityId: string,
): Promise<ProjectTaskReviewInputBundle> {
  const entityId = validateNonEmptyEntityId(projectEntityId, 'projectEntityId')
  const [project] = await listProjectsByEntityIds(userId, [entityId])
  if (!project) {
    throw new Error('loadProjectTaskReviewInput: GTD project not found for user')
  }

  const [orderedIds, deadlines, linkedAll] = await Promise.all([
    loadOrderedThoughtIdsForProject(userId, entityId),
    loadExistingDeadlinesForProject(userId, entityId),
    loadLinkedThoughtSummariesForProject(userId, entityId),
  ])

  const deadlineByThought = new Map(deadlines.map((d) => [d.thoughtId, d.startAt]))
  const nextActionId = project.nextAction?.thoughtId ?? null

  // Prefer sequence order; fall back to project.tasks ranks when sequence is empty.
  const ordered =
    orderedIds.length > 0
      ? orderedIds
      : [...project.tasks].sort((a, b) => a.rank - b.rank).map((t) => t.thoughtId)

  const allCandidateIds = [...new Set([...ordered, ...project.tasks.map((t) => t.thoughtId)])]
  if (allCandidateIds.length === 0) {
    return {
      projectEntityId: entityId,
      projectLabel: project.label,
      projectStatus: project.status,
      projectDeadline: project.targetDate,
      tasks: [],
      linkedThoughts: linkedAll,
      allowedThoughtIds: [],
    }
  }

  const rows = await getDb()
    .select({
      id: thought.id,
      category: thought.category,
      normalizedText: thought.normalizedText,
      normalizedTextEncrypted: thought.normalizedTextEncrypted,
      metadata: thought.metadata,
      metadataEncrypted: thought.metadataEncrypted,
      lifecycleStatus: thought.lifecycleStatus,
    })
    .from(thought)
    .where(and(eq(thought.userId, userId), inArray(thought.id, allCandidateIds)))

  const byId = new Map(rows.map((r) => [r.id, r]))
  const tasks: ProjectReviewTaskInput[] = []

  for (let index = 0; index < ordered.length; index++) {
    const thoughtId = ordered[index]!
    const row = byId.get(thoughtId)
    if (!row || row.category !== 'task') continue

    const metadataJson = row.metadataEncrypted
      ? await decryptTenantValue({
          userId,
          table: 'thought',
          column: 'metadata',
          ciphertext: row.metadataEncrypted,
        })
      : JSON.stringify(row.metadata ?? {})
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>

    const text = row.normalizedTextEncrypted
      ? await decryptTenantValue({
          userId,
          table: 'thought',
          column: 'normalized_text',
          ciphertext: row.normalizedTextEncrypted,
        })
      : row.normalizedText
    const trimmed = text.trim()
    const summary =
      trimmed.length > 120 ? `${trimmed.slice(0, 117).trim()}…` : trimmed || thoughtId

    tasks.push({
      thoughtId,
      summary,
      rank: index + 1,
      status: resolveProjectReviewTaskStatus(row.lifecycleStatus as LifecycleStatus, metadata),
      deadline: deadlineByThought.get(thoughtId) ?? null,
      isNextAction: nextActionId === thoughtId,
    })
  }

  const taskIdSet = new Set(tasks.map((t) => t.thoughtId))
  const linkedThoughts = linkedAll.filter((t) => !taskIdSet.has(t.thoughtId))

  return {
    projectEntityId: entityId,
    projectLabel: project.label,
    projectStatus: project.status,
    projectDeadline: project.targetDate,
    tasks,
    linkedThoughts,
    allowedThoughtIds: [...taskIdSet],
  }
}

export async function reviewProject(input: {
  userId: string
  projectEntityId: string
  goal?: string
}): Promise<ReviewProjectResult> {
  const entityId = validateNonEmptyEntityId(input.projectEntityId, 'projectEntityId')
  const [project] = await listProjectsByEntityIds(input.userId, [entityId])
  if (!project) {
    throw new Error('reviewProject: GTD project not found for user')
  }

  const bundle = await loadProjectTaskReviewInput(input.userId, entityId)
  const review = await extractProjectReview({
    userId: input.userId,
    projectLabel: bundle.projectLabel,
    tasks: bundle.tasks,
    linkedThoughts: bundle.linkedThoughts,
    projectDeadline: bundle.projectDeadline,
    ...(input.goal?.trim() ? { goal: input.goal.trim() } : {}),
  })

  return {
    projectEntityId: entityId,
    projectLabel: bundle.projectLabel,
    projectDeadline: bundle.projectDeadline,
    tasks: bundle.tasks,
    linkedThoughts: bundle.linkedThoughts,
    allowedThoughtIds: bundle.allowedThoughtIds,
    review,
  }
}

export async function applyProjectReview(
  input: ApplyProjectReviewInput,
): Promise<ApplyProjectReviewResult> {
  const entityId = validateNonEmptyEntityId(input.projectEntityId, 'projectEntityId')
  const [project] = await listProjectsByEntityIds(input.userId, [entityId])
  if (!project) {
    throw new Error('applyProjectReview: GTD project not found for user')
  }

  const allowed = new Set(
    input.allowedThoughtIds.map((id) => validateNonEmptyEntityId(id, 'allowedThoughtIds')),
  )

  assertKnownThoughtIds(input.markDone, allowed, 'markDone')
  assertKnownThoughtIds(input.archive, allowed, 'archive')
  assertKnownThoughtIds(
    input.deadlines.map((d) => d.thoughtId),
    allowed,
    'deadlines',
  )
  assertKnownThoughtIds(input.order, allowed, 'order')
  if (input.nextActionThoughtId) {
    assertKnownThoughtIds([input.nextActionThoughtId], allowed, 'nextActionThoughtId')
  }
  if (
    input.nextActionNewTaskIndex != null &&
    (input.nextActionNewTaskIndex < 0 ||
      input.nextActionNewTaskIndex >= input.newTasks.length ||
      !Number.isInteger(input.nextActionNewTaskIndex))
  ) {
    throw new Error('applyProjectReview: nextActionNewTaskIndex out of range')
  }

  const timezone = await getUserPreferredTimezone(input.userId)

  for (const thoughtId of input.markDone) {
    // setThoughtLifecycleStatus clears next-action when status is completed
    await setThoughtLifecycleStatus(input.userId, thoughtId, 'completed')
  }
  for (const thoughtId of input.archive) {
    await setThoughtLifecycleStatus(input.userId, thoughtId, 'archived')
    await clearNextActionIfCompleted(input.userId, thoughtId)
  }

  if ('projectDeadline' in input && input.projectDeadline !== undefined) {
    await setProjectDeadline({
      userId: input.userId,
      projectEntityId: entityId,
      targetDate: input.projectDeadline,
    })
  }

  const summaryById = new Map(project.tasks.map((t) => [t.thoughtId, t.summary]))
  for (const deadline of input.deadlines) {
    const summary = summaryById.get(deadline.thoughtId) ?? 'Task deadline'
    await syncTemporalEventsFromThought({
      userId: input.userId,
      thoughtId: deadline.thoughtId,
      normalizedText: summary,
      precomputedMentions: [
        mentionFromDeadline(summary, deadline.targetDate, timezone, 'deadline'),
      ],
    })
  }

  const createdThoughtIds: string[] = []
  for (const planned of input.newTasks) {
    const summary = planned.summary.trim()
    if (!summary) continue
    const captured = await captureThought(input.userId, summary, { source: 'api' })
    const thoughtId = captured.id
    await markThoughtAsTask(input.userId, thoughtId)
    await linkThoughtToProject(input.userId, entityId, thoughtId, 'manual')
    createdThoughtIds.push(thoughtId)

    if (planned.suggestedStartAt) {
      await syncTemporalEventsFromThought({
        userId: input.userId,
        thoughtId,
        normalizedText: summary,
        precomputedMentions: [
          {
            ...mentionFromDeadline(
              summary,
              planned.suggestedStartAt,
              timezone,
              planned.kind,
            ),
            ...(planned.suggestedEndAt ? { endAt: planned.suggestedEndAt } : {}),
          },
        ],
      })
    }
  }

  const markDoneSet = new Set(input.markDone)
  const archiveSet = new Set(input.archive)
  const orderedExisting = input.order.filter(
    (id) => !markDoneSet.has(id) && !archiveSet.has(id),
  )
  const finalOrder = [...orderedExisting, ...createdThoughtIds]
  await replaceProjectTaskSequence({
    userId: input.userId,
    projectEntityId: entityId,
    orderedThoughtIds: finalOrder,
  })

  let nextActionThoughtId: string | null = null
  if (
    input.nextActionNewTaskIndex != null &&
    createdThoughtIds[input.nextActionNewTaskIndex]
  ) {
    nextActionThoughtId = createdThoughtIds[input.nextActionNewTaskIndex]!
  } else if (input.nextActionThoughtId) {
    nextActionThoughtId = input.nextActionThoughtId
  }

  if (nextActionThoughtId) {
    await designateNextAction(input.userId, entityId, nextActionThoughtId)
  }

  return {
    projectEntityId: entityId,
    createdThoughtIds,
    nextActionThoughtId,
  }
}
