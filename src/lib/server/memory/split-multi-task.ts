/**
 * Multi-to-do fan-out (board e23c4390): one capture that holds several distinct
 * open to-dos becomes one task thought per to-do, each on the capture's thread.
 * The split is an LLM judge decision (ontology policy: never string heuristics) —
 * the judge returns the tasks in the capture's own words; two or more fan out,
 * zero or one stay the capture as it is (no separate verdict flag to contradict the list).
 *
 * It runs during the capture's own enrich pass, after GTD assignment: the parent
 * keeps its thread, and every child copies that thread membership as a `project`
 * decision (never as `manual` — the user did not pick the children). Children
 * carry `metadata.splitFrom` so they are never split again.
 *
 * Failures are loud: a broken judge answer or a contract violation throws, so the
 * enrich worker's deterministic retry applies and the explicit error surfaces —
 * nothing is silently kept as one task when the judge said three.
 */
import { and, eq } from 'drizzle-orm'
import { m } from '$lib/paraglide/messages.js'
import { resolveCategoryKindId } from '$lib/server/capture/capture-confirmation'
import { scheduleCaptureEnrichWorker } from '$lib/server/capture/capture-enrich-worker'
import { queueCapture } from '$lib/server/capture/queue-capture'
import { encryptTenantValue, decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { thought, type MemoryAuthor } from '$lib/server/db/schema'
import { evictOnReject } from '$lib/server/llm/eval-llm-cache'
import { llmChatCompletion } from '$lib/server/llm/llm-client'
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content'
import { loadProjectMembershipEntityIds } from '$lib/server/memory/project-membership'
import { linkThoughtToProject } from '$lib/server/memory/project-next-action'

/** Hard bound on one capture's fan-out: beyond this the judge answer is a contract violation. */
export const MULTI_TASK_FANOUT_MAX = 10

type MultiTaskJudgeResult = { tasks: string[] }

function extractChatContent(response: unknown): string {
  const choices = (response as { choices?: Array<{ message?: { content?: string } }> }).choices
  const content = choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('fanOutMultipleTasks: missing LLM content')
  }
  return content
}

function parseJudgePayload(raw: string): MultiTaskJudgeResult {
  const parsed = JSON.parse(stripMarkdownJsonFences(raw)) as unknown
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('fanOutMultipleTasks: judge answer is not an object')
  }
  const obj = parsed as Record<string, unknown>
  const tasks = obj.tasks
  if (!Array.isArray(tasks)) {
    throw new Error('fanOutMultipleTasks: judge answer has no tasks array')
  }
  for (const task of tasks) {
    if (typeof task !== 'string' || !task.trim()) {
      throw new Error('fanOutMultipleTasks: a task is not a non-empty string')
    }
  }
  if (tasks.length > MULTI_TASK_FANOUT_MAX) {
    throw new Error(
      `fanOutMultipleTasks: ${tasks.length} tasks exceed the fan-out bound of ${MULTI_TASK_FANOUT_MAX}`,
    )
  }
  return { tasks: tasks.map((task) => task.trim()) }
}

/** Enrich-time fan-out: returns the created child thought ids (empty when nothing split). */
export async function fanOutMultipleTasks(input: {
  userId: string
  thoughtId: string
  normalizedText: string
}): Promise<string[]> {
  const db = getDb()
  const [row] = await db
    .select({
      category: thought.category,
      author: thought.author,
      authorLabel: thought.authorLabel,
      authorKeyId: thought.authorKeyId,
      createdAt: thought.createdAt,
      metadata: thought.metadata,
      metadataEncrypted: thought.metadataEncrypted,
    })
    .from(thought)
    .where(and(eq(thought.id, input.thoughtId), eq(thought.userId, input.userId)))
    .limit(1)
  if (!row || row.category !== 'task') return []

  const metadataJson = row.metadataEncrypted
    ? await decryptTenantValue({
        userId: input.userId,
        table: 'thought',
        column: 'metadata',
        ciphertext: row.metadataEncrypted,
      })
    : JSON.stringify(row.metadata ?? {})
  const metadata = JSON.parse(metadataJson) as Record<string, unknown>
  // a split child is never split again, and a parent that already fanned out never duplicates
  if (metadata.splitFrom || metadata.splitInto) return []

  const response = await llmChatCompletion({
    userId: input.userId,
    messages: [
      { role: 'system', content: m.llm_multi_task_system() },
      {
        role: 'user',
        content: [
          'List the distinct open to-dos this captured note contains.',
          'Answer {"tasks":[…]} — one entry per to-do, in the capture\'s own words.',
          'If the note holds one to-do or none, list just that one or an empty array.',
          '',
          `Note: ${input.normalizedText}`,
        ].join('\n'),
      },
    ],
    temperature: 0,
    responseFormat: 'json_object',
  })
  const judge = evictOnReject(response, () => parseJudgePayload(extractChatContent(response)))
  // a single to-do (or none) is not a split — it stays the capture as it is
  if (judge.tasks.length < 2) return []

  // Mark the parent BEFORE creating children: a retried enrich sees the marker and
  // skips, so a crash mid-way can cost children but never duplicates them.
  await persistParentMetadataPatch(input.userId, input.thoughtId, metadata, {
    splitInto: judge.tasks,
  })

  const taskKindId = await resolveCategoryKindId(input.userId, 'task')
  const childIds: string[] = []
  for (const taskText of judge.tasks) {
    const queued = await queueCapture(input.userId, taskText, {
      source: 'ui',
      author: row.author as MemoryAuthor,
      ...(row.authorLabel !== null ? { authorLabel: row.authorLabel } : {}),
      ...(row.authorKeyId !== null ? { authorKeyId: row.authorKeyId } : {}),
      // a child is as old as the capture it came from, not as old as the enrich pass
      capturedAt: row.createdAt,
    })

    // the child is already known to be a task — set its kind and provenance now,
    // so enrich classifies nothing and the fan-out guard holds on its own pass
    const metadataEncrypted = await encryptTenantValue({
      userId: input.userId,
      table: 'thought',
      column: 'metadata',
      plaintext: JSON.stringify({ splitFrom: input.thoughtId }),
    })
    await db
      .update(thought)
      .set({
        category: 'task',
        ontologyEntityKindId: taskKindId,
        metadata: { encrypted: true },
        metadataEncrypted,
        updatedAt: new Date(),
      })
      .where(and(eq(thought.id, queued.thoughtId), eq(thought.userId, input.userId)))

    // the children land on the parent's thread — the pipeline's decision, never 'manual'
    const projectEntityIds = await loadProjectMembershipEntityIds(input.userId, input.thoughtId)
    for (const entityId of projectEntityIds) {
      await linkThoughtToProject(input.userId, entityId, queued.thoughtId, 'project')
    }

    childIds.push(queued.thoughtId)
  }

  if (childIds.length > 0) {
    scheduleCaptureEnrichWorker(input.userId)
    console.log('[multi-task] fan-out created child tasks', {
      userId: input.userId,
      parentId: input.thoughtId,
      childIds,
    })
  }
  return childIds
}

/** Patches the parent's encrypted metadata (fan-out marker) without losing existing keys. */
async function persistParentMetadataPatch(
  userId: string,
  thoughtId: string,
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Promise<void> {
  const metadataEncrypted = await encryptTenantValue({
    userId,
    table: 'thought',
    column: 'metadata',
    plaintext: JSON.stringify({ ...base, ...patch }),
  })
  await getDb()
    .update(thought)
    .set({ metadata: { encrypted: true }, metadataEncrypted, updatedAt: new Date() })
    .where(and(eq(thought.id, thoughtId), eq(thought.userId, userId)))
}
