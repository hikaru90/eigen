/**
 * Time-based salience recompute (consolidation job).
 *
 * Idempotent: formulas depend on elapsed wall-clock time since last access / capture,
 * not on how many heartbeat runs occurred. Running twice in the same second yields
 * the same scores.
 *
 * - Inactive thoughts (7+ days since last access): exponential decay by elapsed days
 * - Unresolved tasks (category task): salience floor rises with days since capture
 * - Exempt thoughts (fact/decision/preference, metadata.neverStale): skip decay
 */

import { and, eq, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm'
import { getDb } from '$lib/server/db'
import { thought } from '$lib/server/db/schema'
import { NEVER_STALE_MEMORY_TYPES } from '$lib/server/memory/thought-staleness'
import { clipThoughtSample, type HeartbeatJobSample } from '$lib/consolidation/heartbeat-job-report'

/** Daily decay multiplier per inactive day beyond the grace window. */
export const DECAY_FACTOR_PER_DAY = 0.97
export const SALIENCE_FLOOR = 0.1
export const SALIENCE_MAX = 5.0
/** No decay until this many days without retrieval access. */
export const INACTIVE_GRACE_DAYS = 7
/** Unresolved task thoughts rise by this much per day since capture. */
export const TASK_RISE_PER_DAY = 0.15

const EXEMPT_MEMORY_TYPES = [...NEVER_STALE_MEMORY_TYPES]
const SAMPLE_LIMIT = 12

export type SalienceComputeResult = {
  decayed: number
  openTasks: number
  samples: HeartbeatJobSample[]
  sampleTotal: number
}

function inactiveDaysSql() {
  return sql`GREATEST(0, EXTRACT(EPOCH FROM (NOW() - COALESCE(${thought.lastAccessedAt}, ${thought.createdAt}))) / 86400.0 - ${INACTIVE_GRACE_DAYS})`
}

function taskDaysSql() {
  return sql`GREATEST(0, EXTRACT(EPOCH FROM (NOW() - ${thought.createdAt})) / 86400.0)`
}

function salienceExemptFilter() {
  return and(
    or(isNull(thought.memoryType), notInArray(thought.memoryType, EXEMPT_MEMORY_TYPES)),
    sql`(${thought.metadata}->>'neverStale') IS DISTINCT FROM 'true'`,
  )
}

export async function runSalienceCompute(userId: string): Promise<SalienceComputeResult> {
  const db = getDb()
  const graceCutoff = new Date()
  graceCutoff.setDate(graceCutoff.getDate() - INACTIVE_GRACE_DAYS)

  console.info('[consolidation.salience_compute] starting', { userId })

  try {
    const decayed = await db
      .update(thought)
      .set({
        salienceScore: sql`GREATEST(${SALIENCE_FLOOR}, ${thought.salienceScore} * POWER(${DECAY_FACTOR_PER_DAY}, ${inactiveDaysSql()}))`,
      })
      .where(
        and(
          eq(thought.userId, userId),
          salienceExemptFilter(),
          or(isNull(thought.lastAccessedAt), lt(thought.lastAccessedAt, graceCutoff)),
          sql`${inactiveDaysSql()} > 0`,
        ),
      )
      .returning({ id: thought.id })

    const openTasks = await db
      .update(thought)
      .set({
        salienceScore: sql`LEAST(${SALIENCE_MAX}, GREATEST(${thought.salienceScore}, 1.0 + ${TASK_RISE_PER_DAY} * ${taskDaysSql()}))`,
      })
      .where(
        and(
          eq(thought.userId, userId),
          eq(thought.category, 'task'),
          sql`(${thought.metadata}->>'status') IS DISTINCT FROM 'completed'`,
          sql`LEAST(${SALIENCE_MAX}, GREATEST(${thought.salienceScore}, 1.0 + ${TASK_RISE_PER_DAY} * ${taskDaysSql()})) <> ${thought.salienceScore}`,
        ),
      )
      .returning({ id: thought.id })

    const decayIds = decayed.map((r) => r.id)
    const taskIds = openTasks.map((r) => r.id)
    const sampleIds = [
      ...decayIds.slice(0, Math.ceil(SAMPLE_LIMIT / 2)),
      ...taskIds.slice(0, Math.floor(SAMPLE_LIMIT / 2)),
    ]
    const uniqueSampleIds = [...new Set(sampleIds)].slice(0, SAMPLE_LIMIT)
    const decayIdSet = new Set(decayIds)
    const taskIdSet = new Set(taskIds)

    let samples: HeartbeatJobSample[] = []
    if (uniqueSampleIds.length > 0) {
      const rows = await db
        .select({ id: thought.id, normalizedText: thought.normalizedText })
        .from(thought)
        .where(and(eq(thought.userId, userId), inArray(thought.id, uniqueSampleIds)))
      const byId = new Map(rows.map((r) => [r.id, r.normalizedText]))
      samples = uniqueSampleIds.flatMap((id) => {
        const text = byId.get(id)
        if (!text) return []
        const notes: string[] = []
        if (decayIdSet.has(id)) notes.push('faded')
        if (taskIdSet.has(id)) notes.push('open task boosted')
        return [
          {
            kind: 'thought' as const,
            id,
            label: clipThoughtSample(text),
            note: notes.join(', '),
          },
        ]
      })
    }

    const result: SalienceComputeResult = {
      decayed: decayed.length,
      openTasks: openTasks.length,
      samples,
      sampleTotal: decayed.length + openTasks.length,
    }
    console.info('[consolidation.salience_compute] finished', {
      userId,
      decayed: result.decayed,
      openTasks: result.openTasks,
    })
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[consolidation.salience_compute] failed', { userId, message })
    throw err
  }
}
