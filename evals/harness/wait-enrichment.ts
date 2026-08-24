import type { WithEvalDbOptions } from './eval-context'
import type { QaChecks } from './qa-types'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { reenrichThought } from '$lib/server/capture/enrich'
import type { AppDatabase } from '$lib/server/db'
import { entityResolutionLog, thought } from '$lib/server/db/brain.schema'
import { resolveEnrichmentKickConcurrency } from '$lib/server/orchestration-concurrency'
import { mapWithConcurrency } from './concurrency'
import { EVAL_ENRICHMENT_TIMEOUT_MS_DEFAULT } from './eval-config'
import { logEval, withEvalDb } from './eval-context'

export type ThoughtEnrichmentTarget = {
  id: string
  normalizedText: string
}

const POLL_INTERVAL_MS = 2000

export function resolveEnrichmentTimeoutMs(): number {
  const raw = process.env.EVAL_ENRICHMENT_TIMEOUT_MS?.trim()
  if (!raw) return EVAL_ENRICHMENT_TIMEOUT_MS_DEFAULT
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`EVAL_ENRICHMENT_TIMEOUT_MS must be a positive number, got: ${raw}`)
  }
  return parsed
}

async function thoughtsWithEntities(
  db: AppDatabase,
  userId: string,
  thoughtIds: string[],
): Promise<Set<string>> {
  if (thoughtIds.length === 0) return new Set()

  const rows = await db
    .selectDistinct({ thoughtId: entityResolutionLog.thoughtId })
    .from(entityResolutionLog)
    .where(
      and(
        eq(entityResolutionLog.userId, userId),
        inArray(entityResolutionLog.thoughtId, thoughtIds),
      ),
    )

  return new Set(rows.map((r) => r.thoughtId))
}

function missingTargets(
  targets: ThoughtEnrichmentTarget[],
  ready: Set<string>,
): ThoughtEnrichmentTarget[] {
  return targets.filter((t) => !ready.has(t.id))
}

/**
 * Wait until each target thought has at least one entity resolution row.
 * Thoughts still missing after the first poll are synchronously re-enriched (eval harness
 * cannot rely on fire-and-forget capture enrichment — 116 thoughts backlog the per-user LLM queue).
 */
export async function waitForThoughtEnrichment(input: {
  db: AppDatabase
  userId: string
  targets: ThoughtEnrichmentTarget[]
  timeoutMs?: number
  /** Operator wallet / platform LLM config for re-enrich kicks. */
  withEvalDbOptions?: WithEvalDbOptions
}): Promise<void> {
  const { db, userId, targets, withEvalDbOptions } = input
  const timeoutMs = input.timeoutMs ?? resolveEnrichmentTimeoutMs()
  const kickConcurrency = resolveEnrichmentKickConcurrency()

  if (targets.length === 0) {
    logEval('enrichment wait: no thoughts to check')
    return
  }

  logEval(
    `enrichment verify: ${targets.length} thought(s), max_wait=${Math.round(timeoutMs / 1000)}s, ` +
      `kick_concurrency=${kickConcurrency}`,
  )

  const pollStart = Date.now()
  let kicked = false

  while (true) {
    const ready = await thoughtsWithEntities(
      db,
      userId,
      targets.map((t) => t.id),
    )
    const missing = missingTargets(targets, ready)
    const elapsed = Date.now() - pollStart

    logEval(
      `enrichment poll: ${ready.size}/${targets.length} thoughts have entities (${elapsed}ms elapsed)`,
    )

    if (missing.length === 0) {
      logEval('all target thoughts enriched')
      return
    }

    if (!kicked) {
      kicked = true
      logEval(
        `enrichment kick: re-running enrich for ${missing.length} thought(s) ` +
          `(background capture enrich is not awaited during seed)`,
      )
      await mapWithConcurrency(missing, kickConcurrency, async (target) => {
        await withEvalDb(
          userId,
          async () => {
            await reenrichThought(userId, target.id, target.normalizedText)
          },
          withEvalDbOptions,
        )
        logEval(`enrichment kick complete: ${target.id}`)
      })
      // Re-poll immediately; if the short test timeout already elapsed, the next
      // iteration must throw without sleeping a full POLL_INTERVAL.
      continue
    }

    const elapsedAfterWork = Date.now() - pollStart
    if (elapsedAfterWork >= timeoutMs) {
      throw new Error(
        `[eval] enrichment timeout after ${timeoutMs}ms — ${missing.length} thought(s) ` +
          `never received entities: ${missing.map((t) => t.id).join(', ')}`,
      )
    }

    const remaining = timeoutMs - elapsedAfterWork
    await new Promise((r) => setTimeout(r, Math.min(POLL_INTERVAL_MS, remaining)))
  }
}

/** Fail fast when inline enrich finished but left no entity resolution rows. */
export async function assertThoughtEntitiesResolved(
  db: AppDatabase,
  userId: string,
  thoughtIds: string[],
): Promise<void> {
  if (thoughtIds.length === 0) return
  const ready = await thoughtsWithEntities(db, userId, thoughtIds)
  const missing = thoughtIds.filter((id) => !ready.has(id))
  if (missing.length > 0) {
    throw new Error(
      `[eval] no entity resolution after enrich for thought(s): ${missing.join(', ')} ` +
        '(see dev logs for [enrich] entities step failed)',
    )
  }
  logEval(`entity resolution ok: ${ready.size}/${thoughtIds.length} thought(s)`)
}

export async function loadThoughtEnrichmentTargets(
  db: AppDatabase,
  userId: string,
  thoughtIds: string[],
): Promise<ThoughtEnrichmentTarget[]> {
  if (thoughtIds.length === 0) return []

  const rows = await db
    .select({
      id: thought.id,
      normalizedText: thought.normalizedText,
    })
    .from(thought)
    .where(and(eq(thought.userId, userId), inArray(thought.id, thoughtIds)))

  const byId = new Map(rows.map((r) => [r.id, r]))
  const missing: string[] = []
  const targets: ThoughtEnrichmentTarget[] = []

  for (const id of thoughtIds) {
    const row = byId.get(id)
    if (!row) {
      missing.push(id)
      continue
    }
    targets.push({ id: row.id, normalizedText: row.normalizedText })
  }

  if (missing.length > 0) {
    throw new Error(
      `[eval] enrichment wait: ${missing.length} thought UUID(s) not found in DB: ${missing.join(', ')}`,
    )
  }

  return targets
}

/** All fixtures that must have enriched_at before structural checks pass. */
export function fixtureIdsRequiringEnrichment(checks: QaChecks): string[] {
  return [...new Set(checks.extraction?.requireEnriched ?? [])]
}

async function thoughtsWithEnrichedAt(
  db: AppDatabase,
  userId: string,
  thoughtIds: string[],
): Promise<Set<string>> {
  if (thoughtIds.length === 0) return new Set()

  const rows = await db
    .select({ id: thought.id })
    .from(thought)
    .where(
      and(
        eq(thought.userId, userId),
        inArray(thought.id, thoughtIds),
        isNotNull(thought.enrichedAt),
      ),
    )

  return new Set(rows.map((r) => r.id))
}

/**
 * Wait until each target thought has enriched_at set (tags/metadata pipeline complete).
 */
export async function waitForThoughtEnrichmentComplete(input: {
  db: AppDatabase
  userId: string
  targets: ThoughtEnrichmentTarget[]
  timeoutMs?: number
  withEvalDbOptions?: WithEvalDbOptions
}): Promise<void> {
  const { db, userId, targets, withEvalDbOptions } = input
  const timeoutMs = input.timeoutMs ?? resolveEnrichmentTimeoutMs()
  const kickConcurrency = resolveEnrichmentKickConcurrency()

  if (targets.length === 0) {
    logEval('enrichment-at wait: no thoughts to check')
    return
  }

  logEval(
    `enrichment-at verify: ${targets.length} thought(s), max_wait=${Math.round(timeoutMs / 1000)}s`,
  )

  const pollStart = Date.now()
  let kicked = false

  while (true) {
    const ready = await thoughtsWithEnrichedAt(
      db,
      userId,
      targets.map((t) => t.id),
    )
    const missing = missingTargets(targets, ready)
    const elapsed = Date.now() - pollStart

    logEval(
      `enrichment-at poll: ${ready.size}/${targets.length} thoughts enriched (${elapsed}ms elapsed)`,
    )

    if (missing.length === 0) {
      logEval('all target thoughts have enriched_at')
      return
    }

    if (!kicked) {
      kicked = true
      logEval(`enrichment-at kick: re-running enrich for ${missing.length} thought(s)`)
      await mapWithConcurrency(missing, kickConcurrency, async (target) => {
        await withEvalDb(
          userId,
          async () => {
            await reenrichThought(userId, target.id, target.normalizedText)
          },
          withEvalDbOptions,
        )
      })
      continue
    }

    if (elapsed >= timeoutMs) {
      throw new Error(
        `[eval] enrichment-at timeout after ${timeoutMs}ms — ${missing.length} thought(s) ` +
          `never received enriched_at: ${missing.map((t) => t.id).join(', ')}`,
      )
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
}
