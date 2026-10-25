/**
 * Multi-to-do fan-out (board e23c4390): one capture that holds several distinct
 * open to-dos becomes one task thought per to-do, each on the capture's thread.
 * The split is an LLM judge decision (ontology policy: never string heuristics) —
 * the judge returns the tasks in the capture's own words or `multiple: false`.
 *
 * It runs during the capture's own enrich pass, after GTD assignment: the parent
 * keeps its thread, and every child copies that thread membership as a `project`
 * decision (never as `manual` — the user did not pick the children). Children
 * carry `metadata.splitFrom` so they are never split again. (Child creation is the shared
 * `queueSplitChild` step, also used by the content-role span split.)
 *
 * Failures are loud: a broken judge answer or a contract violation throws, so the
 * enrich worker's deterministic retry applies and the explicit error surfaces —
 * nothing is silently kept as one task when the judge said three.
 */
import { and, eq } from 'drizzle-orm'
import { m } from '$lib/paraglide/messages.js'
import { resolveCategoryKindId } from '$lib/server/capture/capture-confirmation'
import { scheduleCaptureEnrichWorker } from '$lib/server/capture/capture-enrich-worker'
import { SPLIT_FANOUT_MAX } from '$lib/server/capture/content-role'
import { queueSplitChild } from '$lib/server/capture/queue-split-child'
import { encryptTenantValue, decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { thought, type MemoryAuthor } from '$lib/server/db/schema'
import { llmChatCompletion } from '$lib/server/llm/llm-client'
import { stripMarkdownJsonFences } from '$lib/server/memory/llm-json-content'
import { loadProjectMembershipEntityIds } from '$lib/server/memory/project-membership'
import { linkThoughtToProject } from '$lib/server/memory/project-next-action'

/** Hard bound on one capture's fan-out: beyond this the judge answer is a contract violation. */
export const MULTI_TASK_FANOUT_MAX = SPLIT_FANOUT_MAX

type MultiTaskJudgeResult = { multiple: boolean; tasks?: string[] }

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
  if (obj.multiple !== true && obj.multiple !== false) {
    throw new Error('fanOutMultipleTasks: judge answer has no multiple verdict')
  }
  if (obj.multiple === false) return { multiple: false }

  const tasks = obj.tasks
  if (!Array.isArray(tasks)) {
    throw new Error('fanOutMultipleTasks: multiple:true without a tasks array')
  }
  for (const task of tasks) {
    if (typeof task !== 'string' || !task.trim()) {
      throw new Error('fanOutMultipleTasks: a task is not a non-empty string')
    }
  }
  if (tasks.length < 2) {
    throw new Error(
      `fanOutMultipleTasks: multiple:true needs at least two tasks, got ${tasks.length}`,
    )
  }
  if (tasks.length > MULTI_TASK_FANOUT_MAX) {
    throw new Error(
      `fanOutMultipleTasks: ${tasks.length} tasks exceed the fan-out bound of ${MULTI_TASK_FANOUT_MAX}`,
    )
  }
  return { multiple: true, tasks: tasks.map((task) => task.trim()) }
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
          'Decide whether this captured note contains several distinct open to-dos.',
          'If it holds exactly one to-do (or none), answer {"multiple":false}.',
          'Otherwise answer {"multiple":true,"tasks":[…]} — one entry per to-do, in the capture\'s own words.',
          '',
          `Note: ${input.normalizedText}`,
        ].join('\n'),
      },
    ],
    temperature: 0,
  })
  const judge = parseJudgePayload(extractChatContent(response))
  if (!judge.multiple || !judge.tasks) return []

  // Mark the parent BEFORE creating children: a retried enrich sees the marker and
  // skips, so a crash mid-way can cost children but never duplicates them.
  await persistParentMetadataPatch(input.userId, input.thoughtId, metadata, {
    splitInto: judge.tasks,
  })

  const taskKindId = await resolveCategoryKindId(input.userId, 'task')
  const childIds: string[] = []
  for (const taskText of judge.tasks) {
    // the child is already known to be a task — set its kind and provenance now,
    // so enrich classifies nothing and the fan-out guard holds on its own pass
    const childId = await queueSplitChild({
      userId: input.userId,
      parentThoughtId: input.thoughtId,
      parent: {
        author: row.author as MemoryAuthor,
        authorLabel: row.authorLabel,
        authorKeyId: row.authorKeyId,
        createdAt: row.createdAt,
      },
      text: taskText,
      category: { key: 'task', ontologyEntityKindId: taskKindId },
    })

    // the children land on the parent's thread — the pipeline's decision, never 'manual'
    const projectEntityIds = await loadProjectMembershipEntityIds(input.userId, input.thoughtId)
    for (const entityId of projectEntityIds) {
      await linkThoughtToProject(input.userId, entityId, childId, 'project')
    }

    childIds.push(childId)
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
