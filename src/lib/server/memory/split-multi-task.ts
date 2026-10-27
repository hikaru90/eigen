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
import { ownerCorrectionBlock } from '$lib/server/capture/owner-correction'
import { queueCapture } from '$lib/server/capture/queue-capture'
import { encryptTenantValue, decryptTenantValue } from '$lib/server/crypto/tenant-encryption'
import { getDb } from '$lib/server/db'
import { thought, type MemoryAuthor } from '$lib/server/db/schema'
import { runIngestWithRetries } from '$lib/server/ingest/retry'
import { evictOnReject } from '$lib/server/llm/eval-llm-cache'
import { llmChatCompletion } from '$lib/server/llm/llm-client'
import { setThoughtLifecycleStatus } from '$lib/server/memory/lifecycle'
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

/**
 * Asks the split judge for the distinct open to-dos of a note, in the note's own words. With an
 * owner correction (a 👎 reason) the judge is told the last split was wrong and why.
 */
async function judgeTasks(input: {
  userId: string
  normalizedText: string
  ownerCorrection?: string
}): Promise<MultiTaskJudgeResult> {
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
          ...(input.ownerCorrection === undefined
            ? []
            : ['', ownerCorrectionBlock(input.ownerCorrection)]),
          '',
          `Note: ${input.normalizedText}`,
        ].join('\n'),
      },
    ],
    temperature: 0,
    responseFormat: 'json_object',
  })
  return evictOnReject(response, () => parseJudgePayload(extractChatContent(response)))
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

  const judge = await judgeTasks({
    userId: input.userId,
    normalizedText: input.normalizedText,
  })
  // a single to-do (or none) is not a split — it stays the capture as it is
  if (judge.tasks.length < 2) return []

  // Mark the parent BEFORE creating children: a retried enrich sees the marker and
  // skips, so a crash mid-way can cost children but never duplicates them.
  await persistParentMetadataPatch(input.userId, input.thoughtId, metadata, {
    splitInto: judge.tasks,
  })

  const childIds = await createSplitChildren({
    userId: input.userId,
    parentId: input.thoughtId,
    tasks: judge.tasks,
    row,
  })

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

type SplitParentRow = {
  author: string
  authorLabel: string | null
  authorKeyId: string | null
  createdAt: Date
}

/** One task thought per to-do, on the parent's thread, marked `splitFrom`. */
async function createSplitChildren(input: {
  userId: string
  parentId: string
  tasks: string[]
  row: SplitParentRow
}): Promise<string[]> {
  const db = getDb()
  const { row } = input
  const taskKindId = await resolveCategoryKindId(input.userId, 'task')
  const childIds: string[] = []
  for (const taskText of input.tasks) {
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
      plaintext: JSON.stringify({ splitFrom: input.parentId }),
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
    const projectEntityIds = await loadProjectMembershipEntityIds(input.userId, input.parentId)
    for (const entityId of projectEntityIds) {
      await linkThoughtToProject(input.userId, entityId, queued.thoughtId, 'project')
    }

    childIds.push(queued.thoughtId)
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

export type RedoSplitResult = {
  /** The capture that was split (the voted thought itself, or the parent a voted child came from). */
  parentId: string
  /** The pieces the judge now returns; fewer than two means the capture stays one thought. */
  tasks: string[]
  /** Old children that were untouched: archived through the lifecycle, never deleted. */
  archivedChildIds: string[]
  /** Old children left alone because the owner completed, archived, snoozed or edited them. */
  keptChildIds: string[]
  newChildIds: string[]
}

async function decryptMetadata(
  userId: string,
  row: { metadata: Record<string, unknown> | null; metadataEncrypted: string | null },
): Promise<Record<string, unknown>> {
  if (!row.metadataEncrypted) return { ...(row.metadata ?? {}) }
  const json = await decryptTenantValue({
    userId,
    table: 'thought',
    column: 'metadata',
    ciphertext: row.metadataEncrypted,
  })
  return JSON.parse(json) as Record<string, unknown>
}

/**
 * The children a fan-out made for `parent`: tasks born at the parent's own capture time (the
 * fan-out gives every child the parent's `createdAt`) whose metadata says `splitFrom` the parent.
 * Metadata is encrypted, so the time narrows the candidates and the marker decides.
 *
 * "Edited" is read from persisted structure, not from meaning: the edit path stamps
 * `metadata.lastEditRequest` on every natural-language edit, and a child's `raw_text` is exactly
 * the piece the fan-out recorded in the parent's `splitInto` until someone rewrites it.
 */
async function loadSplitChildren(input: {
  userId: string
  parentId: string
  parentCreatedAt: Date
  pieces: string[]
}): Promise<Array<{ id: string; untouched: boolean; lifecycleStatus: string }>> {
  const rows = await getDb()
    .select({
      id: thought.id,
      rawText: thought.rawText,
      rawTextEncrypted: thought.rawTextEncrypted,
      lifecycleStatus: thought.lifecycleStatus,
      metadata: thought.metadata,
      metadataEncrypted: thought.metadataEncrypted,
    })
    .from(thought)
    .where(and(eq(thought.userId, input.userId), eq(thought.createdAt, input.parentCreatedAt)))
  const children: Array<{ id: string; untouched: boolean; lifecycleStatus: string }> = []
  for (const row of rows) {
    if (row.id === input.parentId) continue
    const metadata = await decryptMetadata(input.userId, row)
    if (metadata.splitFrom !== input.parentId) continue
    const rawText = row.rawTextEncrypted
      ? await decryptTenantValue({
          userId: input.userId,
          table: 'thought',
          column: 'raw_text',
          ciphertext: row.rawTextEncrypted,
        })
      : row.rawText
    const edited = metadata.lastEditRequest !== undefined || !input.pieces.includes(rawText.trim())
    children.push({
      id: row.id,
      untouched: row.lifecycleStatus === 'open' && !edited,
      lifecycleStatus: row.lifecycleStatus,
    })
  }
  return children
}

/**
 * Redoes the split of a capture after the owner said it was wrong (a 👎 reason labelled
 * `split_wrong`). The judge reads the parent again with the owner's correction (prompt context
 * only). Nothing is changed until the judge has answered; then the untouched old children are
 * archived (never deleted), the parent's `splitInto` is replaced (or removed when the judge now
 * sees one thought) and the new children are created like the first fan-out made them.
 *
 * `thoughtId` may be the parent or one of its children (the vote can be on either).
 */
export async function redoCaptureSplit(input: {
  userId: string
  thoughtId: string
  ownerCorrection: string
}): Promise<RedoSplitResult> {
  const db = getDb()
  const columns = {
    id: thought.id,
    author: thought.author,
    authorLabel: thought.authorLabel,
    authorKeyId: thought.authorKeyId,
    createdAt: thought.createdAt,
    normalizedText: thought.normalizedText,
    normalizedTextEncrypted: thought.normalizedTextEncrypted,
    metadata: thought.metadata,
    metadataEncrypted: thought.metadataEncrypted,
  }
  const [voted] = await db
    .select(columns)
    .from(thought)
    .where(and(eq(thought.id, input.thoughtId), eq(thought.userId, input.userId)))
    .limit(1)
  if (!voted) throw new Error('redoCaptureSplit: thought not found')
  const votedMetadata = await decryptMetadata(input.userId, voted)
  const parentId =
    typeof votedMetadata.splitFrom === 'string' && votedMetadata.splitFrom !== ''
      ? votedMetadata.splitFrom
      : input.thoughtId

  const [parent] =
    parentId === voted.id
      ? [voted]
      : await db
          .select(columns)
          .from(thought)
          .where(and(eq(thought.id, parentId), eq(thought.userId, input.userId)))
          .limit(1)
  if (!parent) throw new Error('redoCaptureSplit: the split parent no longer exists')
  const parentMetadata =
    parent === voted ? votedMetadata : await decryptMetadata(input.userId, parent)
  const normalizedText = parent.normalizedTextEncrypted
    ? await decryptTenantValue({
        userId: input.userId,
        table: 'thought',
        column: 'normalized_text',
        ciphertext: parent.normalizedTextEncrypted,
      })
    : parent.normalizedText

  // 1. the judge first: if it throws, nothing has changed yet
  const judge = await runIngestWithRetries(() =>
    judgeTasks({
      userId: input.userId,
      normalizedText,
      ownerCorrection: input.ownerCorrection,
    }),
  )

  // 2. old children: archive the untouched, leave the rest
  const pieces = Array.isArray(parentMetadata.splitInto)
    ? (parentMetadata.splitInto as unknown[]).filter((p): p is string => typeof p === 'string')
    : []
  const children = await loadSplitChildren({
    userId: input.userId,
    parentId,
    parentCreatedAt: parent.createdAt,
    pieces,
  })
  const archivedChildIds: string[] = []
  const keptChildIds: string[] = []
  for (const child of children) {
    if (!child.untouched) {
      keptChildIds.push(child.id)
      continue
    }
    const archived = await setThoughtLifecycleStatus(input.userId, child.id, 'archived')
    if (!archived.ok) throw new Error('redoCaptureSplit: could not archive an old child')
    archivedChildIds.push(child.id)
  }

  // 3. the parent's marker, then the new children (marker first, like the first fan-out)
  const splits = judge.tasks.length >= 2
  const withoutMarker = { ...parentMetadata }
  delete withoutMarker.splitInto
  await persistParentMetadataPatch(
    input.userId,
    parentId,
    withoutMarker,
    splits ? { splitInto: judge.tasks } : {},
  )
  const newChildIds = splits
    ? await createSplitChildren({ userId: input.userId, parentId, tasks: judge.tasks, row: parent })
    : []
  if (newChildIds.length > 0) scheduleCaptureEnrichWorker(input.userId)

  console.log('[multi-task] split redone after an owner correction', {
    userId: input.userId,
    parentId,
    correctionChars: input.ownerCorrection.length,
    archived: archivedChildIds.length,
    kept: keptChildIds.length,
    created: newChildIds.length,
  })
  return { parentId, tasks: judge.tasks, archivedChildIds, keptChildIds, newChildIds }
}

/**
 * The split family of a thought, for comparing stored data before and after a re-check: the parent
 * (the thought itself, or the parent a child names), the pieces the parent recorded and the
 * children with their lifecycle status. Null for a thought that is neither split nor a split child.
 */
export async function readSplitFamily(input: { userId: string; thoughtId: string }): Promise<{
  parentId: string
  pieces: string[]
  children: Array<{ id: string; lifecycleStatus: string }>
} | null> {
  const db = getDb()
  const columns = {
    id: thought.id,
    createdAt: thought.createdAt,
    metadata: thought.metadata,
    metadataEncrypted: thought.metadataEncrypted,
  }
  const [voted] = await db
    .select(columns)
    .from(thought)
    .where(and(eq(thought.id, input.thoughtId), eq(thought.userId, input.userId)))
    .limit(1)
  if (!voted) return null
  const votedMetadata = await decryptMetadata(input.userId, voted)
  const parentId =
    typeof votedMetadata.splitFrom === 'string' && votedMetadata.splitFrom !== ''
      ? votedMetadata.splitFrom
      : input.thoughtId
  if (parentId === voted.id && votedMetadata.splitInto === undefined) return null
  const [parent] =
    parentId === voted.id
      ? [voted]
      : await db
          .select(columns)
          .from(thought)
          .where(and(eq(thought.id, parentId), eq(thought.userId, input.userId)))
          .limit(1)
  if (!parent) return null
  const parentMetadata =
    parent === voted ? votedMetadata : await decryptMetadata(input.userId, parent)
  const pieces = Array.isArray(parentMetadata.splitInto)
    ? (parentMetadata.splitInto as unknown[]).filter((p): p is string => typeof p === 'string')
    : []
  const children = await loadSplitChildren({
    userId: input.userId,
    parentId,
    parentCreatedAt: parent.createdAt,
    pieces,
  })
  return {
    parentId,
    pieces,
    children: children.map((c) => ({ id: c.id, lifecycleStatus: c.lifecycleStatus })),
  }
}
