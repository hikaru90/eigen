import type { EvalEntrySummary, EvalRunListItem, EvalRunSummary, EvalSynthesis } from './types'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { APP_VERSION } from '$lib/app-version'
import { withDbUser } from '$lib/server/db'
import {
  evalEntry,
  evalEvent,
  evalRun,
  evalThoughtMap,
  type EvalEntryKind,
  type EvalEntryStatus,
  type EvalRunStatus,
} from '$lib/server/db/brain.schema'
import { activityCallLog } from '$lib/server/db/brain.schema'
import { evalCorpusUserId } from '../../../evals/harness/eval-config'
import { aggregateRunScores, resolveRunStatusFromScore } from './display'

export { evalCorpusUserId }

export type CorpusFixtureRef = {
  thoughtId: string
  sourceRunId: string
}

export async function createEvalRun(input: {
  operatorUserId: string
  label: string
  scenarioId?: string
  config?: Record<string, unknown>
}): Promise<{ runId: string; evalUserId: string }> {
  const evalUserId = evalCorpusUserId(input.operatorUserId)
  return withDbUser(input.operatorUserId, async (db) => {
    const [row] = await db
      .insert(evalRun)
      .values({
        userId: input.operatorUserId,
        evalUserId,
        label: input.label,
        scenarioId: input.scenarioId ?? null,
        status: 'draft',
        configJson: { appVersion: APP_VERSION, ...(input.config ?? {}) },
      })
      .returning({ id: evalRun.id })

    return { runId: row.id, evalUserId }
  })
}

export async function insertEvalEntries(
  operatorUserId: string,
  runId: string,
  entries: Array<{
    ordinal: number
    kind: EvalEntryKind
    fixtureRef?: string
    inputJson: Record<string, unknown>
    expectedJson?: Record<string, unknown>
    dependsOnEntryId?: string
  }>,
): Promise<void> {
  await withDbUser(operatorUserId, async (db) => {
    if (entries.length === 0) return
    await db.insert(evalEntry).values(
      entries.map((e) => ({
        runId,
        ordinal: e.ordinal,
        kind: e.kind,
        fixtureRef: e.fixtureRef ?? null,
        inputJson: e.inputJson,
        expectedJson: e.expectedJson ?? {},
        dependsOnEntryId: e.dependsOnEntryId ?? null,
      })),
    )
  })
}

export async function appendEvalEvent(input: {
  operatorUserId: string
  runId: string
  entryId?: string
  level?: string
  message: string
}): Promise<void> {
  await withDbUser(input.operatorUserId, async (db) => {
    await db.insert(evalEvent).values({
      runId: input.runId,
      entryId: input.entryId ?? null,
      level: input.level ?? 'info',
      message: input.message,
    })
  })
}

export async function updateEvalRunStatus(
  operatorUserId: string,
  runId: string,
  patch: {
    status?: EvalRunStatus
    startedAt?: Date
    finishedAt?: Date
    error?: string | null
    synthesisJson?: EvalSynthesis
  },
): Promise<void> {
  await withDbUser(operatorUserId, async (db) => {
    await db
      .update(evalRun)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
        ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
        ...(patch.synthesisJson !== undefined
          ? { synthesisJson: patch.synthesisJson as Record<string, unknown> }
          : {}),
      })
      .where(eq(evalRun.id, runId))
  })
}

export async function updateEvalEntry(
  operatorUserId: string,
  entryId: string,
  patch: {
    status?: EvalEntryStatus
    passed?: boolean | null
    resultJson?: Record<string, unknown>
    error?: string | null
    durationMs?: number | null
    startedAt?: Date | null
    finishedAt?: Date | null
  },
): Promise<void> {
  await withDbUser(operatorUserId, async (db) => {
    await db
      .update(evalEntry)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.passed !== undefined ? { passed: patch.passed } : {}),
        ...(patch.resultJson !== undefined ? { resultJson: patch.resultJson } : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
        ...(patch.durationMs !== undefined ? { durationMs: patch.durationMs } : {}),
        ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
        ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
      })
      .where(eq(evalEntry.id, entryId))
  })
}

export async function upsertThoughtMap(
  operatorUserId: string,
  runId: string,
  fixtureId: string,
  thoughtId: string,
): Promise<void> {
  await withDbUser(operatorUserId, async (db) => {
    await db
      .insert(evalThoughtMap)
      .values({ runId, fixtureId, thoughtId })
      .onConflictDoUpdate({
        target: [evalThoughtMap.runId, evalThoughtMap.fixtureId],
        set: { thoughtId },
      })
  })
}

export async function getThoughtMap(
  operatorUserId: string,
  runId: string,
): Promise<Map<string, string>> {
  return withDbUser(operatorUserId, async (db) => {
    const rows = await db.select().from(evalThoughtMap).where(eq(evalThoughtMap.runId, runId))
    return new Map(rows.map((r) => [r.fixtureId, r.thoughtId]))
  })
}

/** Latest fixture → thought mapping across all runs for a shared corpus tenant. */
export async function getCorpusFixtureMap(
  operatorUserId: string,
  evalUserId: string,
): Promise<Map<string, CorpusFixtureRef>> {
  return withDbUser(operatorUserId, async (db) => {
    const result = await db.execute(sql`
			SELECT DISTINCT ON (etm.fixture_id)
				etm.fixture_id AS fixture_id,
				etm.thought_id AS thought_id,
				etm.run_id AS source_run_id
			FROM eval_thought_map etm
			INNER JOIN eval_run er ON er.id = etm.run_id
			INNER JOIN thought t ON t.id = etm.thought_id AND t.user_id = er.eval_user_id
			WHERE er.eval_user_id = ${evalUserId}
			ORDER BY etm.fixture_id, er.created_at DESC
		`)
    const rows = Array.isArray(result)
      ? result
      : [...(result as unknown as Iterable<Record<string, unknown>>)]
    const map = new Map<string, CorpusFixtureRef>()
    for (const row of rows) {
      const r = row as Record<string, unknown>
      const fixtureId = String(r.fixture_id ?? '')
      if (!fixtureId) continue
      map.set(fixtureId, {
        thoughtId: String(r.thought_id),
        sourceRunId: String(r.source_run_id),
      })
    }
    return map
  })
}

export async function getEvalRunRow(operatorUserId: string, runId: string) {
  return withDbUser(operatorUserId, async (db) => {
    const [row] = await db.select().from(evalRun).where(eq(evalRun.id, runId))
    return row ?? null
  })
}

export async function listEvalEntries(operatorUserId: string, runId: string) {
  return withDbUser(operatorUserId, async (db) => {
    return db
      .select()
      .from(evalEntry)
      .where(eq(evalEntry.runId, runId))
      .orderBy(asc(evalEntry.ordinal))
  })
}

export async function listEvalEvents(
  operatorUserId: string,
  runId: string,
  limit = 200,
): Promise<
  Array<{ id: string; entryId: string | null; level: string; message: string; createdAt: Date }>
> {
  return withDbUser(operatorUserId, async (db) => {
    return db
      .select({
        id: evalEvent.id,
        entryId: evalEvent.entryId,
        level: evalEvent.level,
        message: evalEvent.message,
        createdAt: evalEvent.createdAt,
      })
      .from(evalEvent)
      .where(eq(evalEvent.runId, runId))
      .orderBy(desc(evalEvent.createdAt))
      .limit(limit)
  })
}

/** Align stored run status with point-based score (fixes legacy anyFailed finalization). */
export async function reconcileEvalRunStatus(
  operatorUserId: string,
  runId: string,
): Promise<boolean> {
  const detail = await loadEvalRunDetail(operatorUserId, runId)
  if (!detail) return false
  if (detail.run.status === 'running' || detail.run.status === 'draft') return false

  const score = aggregateRunScores(detail.entries)
  const resolved = resolveRunStatusFromScore(detail.run.status, score)
  if (resolved === detail.run.status) return false

  await updateEvalRunStatus(operatorUserId, runId, {
    status: resolved as EvalRunStatus,
  })
  return true
}

/** Patch finished runs for the current release so lists/overview match earned points. */
export async function reconcileVersionEvalRuns(operatorUserId: string): Promise<number> {
  return withDbUser(operatorUserId, async (db) => {
    const runs = await db
      .select({ id: evalRun.id })
      .from(evalRun)
      .where(
        and(
          eq(evalRun.userId, operatorUserId),
          sql`${evalRun.configJson}->>'appVersion' = ${APP_VERSION}`,
          inArray(evalRun.status, ['failed', 'completed']),
        ),
      )
      .orderBy(desc(evalRun.createdAt))

    let updated = 0
    for (const run of runs) {
      if (await reconcileEvalRunStatus(operatorUserId, run.id)) updated += 1
    }
    return updated
  })
}

export async function listEvalRuns(
  operatorUserId: string,
  limit = 100,
): Promise<EvalRunListItem[]> {
  return withDbUser(operatorUserId, async (db) => {
    const runs = await db
      .select({
        id: evalRun.id,
        label: evalRun.label,
        scenarioId: evalRun.scenarioId,
        status: evalRun.status,
        createdAt: evalRun.createdAt,
        startedAt: evalRun.startedAt,
        finishedAt: evalRun.finishedAt,
      })
      .from(evalRun)
      .where(eq(evalRun.userId, operatorUserId))
      .orderBy(desc(evalRun.createdAt))
      .limit(limit)

    if (runs.length === 0) return []

    const runIds = runs.map((r) => r.id)
    const stats = await db
      .select({
        runId: evalEntry.runId,
        entryCount: sql<number>`count(*)::int`,
        passedCount: sql<number>`count(*) filter (where ${evalEntry.passed} = true)::int`,
        failedCount: sql<number>`count(*) filter (where ${evalEntry.passed} = false)::int`,
      })
      .from(evalEntry)
      .where(inArray(evalEntry.runId, runIds))
      .groupBy(evalEntry.runId)

    const statsMap = new Map(stats.map((s) => [s.runId, s]))

    return runs.map((r) => ({
      id: r.id,
      label: r.label,
      scenarioId: r.scenarioId,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      startedAt: r.startedAt?.toISOString() ?? null,
      finishedAt: r.finishedAt?.toISOString() ?? null,
      entryCount: statsMap.get(r.id)?.entryCount ?? 0,
      passedCount: statsMap.get(r.id)?.passedCount ?? 0,
      failedCount: statsMap.get(r.id)?.failedCount ?? 0,
    }))
  })
}

export async function getLatestEvalRun(operatorUserId: string) {
  return withDbUser(operatorUserId, async (db) => {
    const [row] = await db
      .select()
      .from(evalRun)
      .where(eq(evalRun.userId, operatorUserId))
      .orderBy(desc(evalRun.createdAt))
      .limit(1)
    return row ?? null
  })
}

async function loadEvalRunLlmTiming(
  evalUserId: string,
  runId: string,
): Promise<Record<string, { count: number; totalMs: number }>> {
  return withDbUser(evalUserId, async (db) => {
    const llmCalls = await db
      .select({
        operation: activityCallLog.operation,
        durationMs: activityCallLog.durationMs,
      })
      .from(activityCallLog)
      .where(eq(activityCallLog.groupId, runId))

    return llmCalls.reduce(
      (acc, row) => {
        const ms = typeof row.durationMs === 'number' ? row.durationMs : null
        const op = String(row.operation ?? '')
        if (!op || ms == null) return acc
        const cur = acc[op] ?? { count: 0, totalMs: 0 }
        cur.count += 1
        cur.totalMs += ms
        acc[op] = cur
        return acc
      },
      {} as Record<string, { count: number; totalMs: number }>,
    )
  })
}

export async function loadEvalRunDetail(
  operatorUserId: string,
  runId: string,
): Promise<{ run: EvalRunSummary & { timing?: unknown }; entries: EvalEntrySummary[] } | null> {
  const base = await withDbUser(operatorUserId, async (db) => {
    const [run] = await db.select().from(evalRun).where(eq(evalRun.id, runId))
    if (!run) return null

    const entries = await db
      .select()
      .from(evalEntry)
      .where(eq(evalEntry.runId, runId))
      .orderBy(asc(evalEntry.ordinal))

    const passedCount = entries.filter((e) => e.passed === true).length
    const failedCount = entries.filter((e) => e.passed === false).length

    const entryDurationByKind = entries.reduce(
      (acc, e) => {
        const ms = typeof e.durationMs === 'number' ? e.durationMs : null
        if (ms == null) return acc
        const key = e.kind
        const cur = acc[key] ?? { count: 0, totalMs: 0 }
        cur.count += 1
        cur.totalMs += ms
        acc[key] = cur
        return acc
      },
      {} as Record<string, { count: number; totalMs: number }>,
    )

    return { run, entries, passedCount, failedCount, entryDurationByKind }
  })

  if (!base) return null

  const llmDurationByOperation = await loadEvalRunLlmTiming(base.run.evalUserId, runId)

  return {
    run: {
      id: base.run.id,
      label: base.run.label,
      scenarioId: base.run.scenarioId,
      status: base.run.status,
      evalUserId: base.run.evalUserId,
      startedAt: base.run.startedAt?.toISOString() ?? null,
      finishedAt: base.run.finishedAt?.toISOString() ?? null,
      error: base.run.error,
      synthesis: (base.run.synthesisJson as EvalSynthesis | null) ?? null,
      entryCount: base.entries.length,
      passedCount: base.passedCount,
      failedCount: base.failedCount,
      timing: {
        entryDurationByKind: base.entryDurationByKind,
        llmDurationByOperation,
      },
    },
    entries: base.entries.map((e) => ({
      id: e.id,
      ordinal: e.ordinal,
      kind: e.kind,
      fixtureRef: e.fixtureRef,
      status: e.status,
      passed: e.passed,
      durationMs: e.durationMs,
      error: e.error,
      input: e.inputJson as Record<string, unknown>,
      expected: e.expectedJson as Record<string, unknown>,
      result: (e.resultJson as Record<string, unknown> | null) ?? null,
    })),
  }
}

/** Bypass RLS for eval harness bootstrap (create eval corpus / operator user row). */
export async function insertEvalUserRow(userId: string, name: string): Promise<void> {
  const { user } = await import('$lib/server/db/auth.schema')
  const { authDb } = await import('$lib/server/db/auth-db')
  const existing = await authDb.select().from(user).where(eq(user.id, userId))
  if (existing.length > 0) {
    await authDb
      .update(user)
      .set({ onboardingCompleted: true, accountKind: 'harness' })
      .where(eq(user.id, userId))
  } else {
    await authDb.insert(user).values({
      id: userId,
      name,
      email: `${userId}@local.eval`,
      emailVerified: true,
      onboardingCompleted: true,
      accountKind: 'harness',
    })
  }

  const { ensureHarnessWalletCredits } = await import('$lib/server/billing/ensure-harness-credits')
  await ensureHarnessWalletCredits(userId)
}

export async function deleteEvalUserRow(userId: string): Promise<void> {
  const { user } = await import('$lib/server/db/auth.schema')
  const { authDb } = await import('$lib/server/db/auth-db')
  await authDb.delete(user).where(eq(user.id, userId))
}

export async function countRunsForOperator(operatorUserId: string): Promise<number> {
  return withDbUser(operatorUserId, async (db) => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(evalRun)
      .where(eq(evalRun.userId, operatorUserId))
    return Number(row?.n ?? 0)
  })
}
