import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
	evalEntry,
	evalEvent,
	evalRun,
	evalThoughtMap,
	type EvalEntryKind,
	type EvalEntryStatus,
	type EvalRunStatus
} from '$lib/server/db/brain.schema';
import { getDb, withDbUser } from '$lib/server/db';
import type { EvalEntrySummary, EvalRunListItem, EvalRunSummary, EvalSynthesis } from './types';

export function newEvalUserId(runId: string): string {
	return `eval-${runId.slice(0, 8)}`;
}

export async function createEvalRun(input: {
	operatorUserId: string;
	label: string;
	scenarioId?: string;
	config?: Record<string, unknown>;
}): Promise<{ runId: string; evalUserId: string }> {
	return withDbUser(input.operatorUserId, async (db) => {
		const [row] = await db
			.insert(evalRun)
			.values({
				userId: input.operatorUserId,
				evalUserId: 'pending',
				label: input.label,
				scenarioId: input.scenarioId ?? null,
				status: 'draft',
				configJson: input.config ?? {}
			})
			.returning({ id: evalRun.id });

		const evalUserId = newEvalUserId(row.id);
		await db
			.update(evalRun)
			.set({ evalUserId })
			.where(eq(evalRun.id, row.id));

		return { runId: row.id, evalUserId };
	});
}

export async function insertEvalEntries(
	operatorUserId: string,
	runId: string,
	entries: Array<{
		ordinal: number;
		kind: EvalEntryKind;
		fixtureRef?: string;
		inputJson: Record<string, unknown>;
		expectedJson?: Record<string, unknown>;
		dependsOnEntryId?: string;
	}>
): Promise<void> {
	await withDbUser(operatorUserId, async (db) => {
		if (entries.length === 0) return;
		await db.insert(evalEntry).values(
			entries.map((e) => ({
				runId,
				ordinal: e.ordinal,
				kind: e.kind,
				fixtureRef: e.fixtureRef ?? null,
				inputJson: e.inputJson,
				expectedJson: e.expectedJson ?? {},
				dependsOnEntryId: e.dependsOnEntryId ?? null
			}))
		);
	});
}

export async function appendEvalEvent(input: {
	operatorUserId: string;
	runId: string;
	entryId?: string;
	level?: string;
	message: string;
}): Promise<void> {
	await withDbUser(input.operatorUserId, async (db) => {
		await db.insert(evalEvent).values({
			runId: input.runId,
			entryId: input.entryId ?? null,
			level: input.level ?? 'info',
			message: input.message
		});
	});
}

export async function updateEvalRunStatus(
	operatorUserId: string,
	runId: string,
	patch: {
		status?: EvalRunStatus;
		startedAt?: Date;
		finishedAt?: Date;
		error?: string | null;
		synthesisJson?: EvalSynthesis;
	}
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
					: {})
			})
			.where(eq(evalRun.id, runId));
	});
}

export async function updateEvalEntry(
	operatorUserId: string,
	entryId: string,
	patch: {
		status?: EvalEntryStatus;
		passed?: boolean | null;
		resultJson?: Record<string, unknown>;
		error?: string | null;
		durationMs?: number;
		startedAt?: Date;
		finishedAt?: Date;
	}
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
				...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {})
			})
			.where(eq(evalEntry.id, entryId));
	});
}

export async function upsertThoughtMap(
	operatorUserId: string,
	runId: string,
	fixtureId: string,
	thoughtId: string
): Promise<void> {
	await withDbUser(operatorUserId, async (db) => {
		await db
			.insert(evalThoughtMap)
			.values({ runId, fixtureId, thoughtId })
			.onConflictDoUpdate({
				target: [evalThoughtMap.runId, evalThoughtMap.fixtureId],
				set: { thoughtId }
			});
	});
}

export async function getThoughtMap(
	operatorUserId: string,
	runId: string
): Promise<Map<string, string>> {
	return withDbUser(operatorUserId, async (db) => {
		const rows = await db
			.select()
			.from(evalThoughtMap)
			.where(eq(evalThoughtMap.runId, runId));
		return new Map(rows.map((r) => [r.fixtureId, r.thoughtId]));
	});
}

export async function getEvalRunRow(operatorUserId: string, runId: string) {
	return withDbUser(operatorUserId, async (db) => {
		const [row] = await db.select().from(evalRun).where(eq(evalRun.id, runId));
		return row ?? null;
	});
}

export async function listEvalEntries(operatorUserId: string, runId: string) {
	return withDbUser(operatorUserId, async (db) => {
		return db
			.select()
			.from(evalEntry)
			.where(eq(evalEntry.runId, runId))
			.orderBy(asc(evalEntry.ordinal));
	});
}

export async function listEvalEvents(
	operatorUserId: string,
	runId: string,
	limit = 200
): Promise<Array<{ id: string; entryId: string | null; level: string; message: string; createdAt: Date }>> {
	return withDbUser(operatorUserId, async (db) => {
		return db
			.select({
				id: evalEvent.id,
				entryId: evalEvent.entryId,
				level: evalEvent.level,
				message: evalEvent.message,
				createdAt: evalEvent.createdAt
			})
			.from(evalEvent)
			.where(eq(evalEvent.runId, runId))
			.orderBy(desc(evalEvent.createdAt))
			.limit(limit);
	});
}

export async function listEvalRuns(
	operatorUserId: string,
	limit = 100
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
				finishedAt: evalRun.finishedAt
			})
			.from(evalRun)
			.where(eq(evalRun.userId, operatorUserId))
			.orderBy(desc(evalRun.createdAt))
			.limit(limit);

		if (runs.length === 0) return [];

		const runIds = runs.map((r) => r.id);
		const stats = await db
			.select({
				runId: evalEntry.runId,
				entryCount: sql<number>`count(*)::int`,
				passedCount: sql<number>`count(*) filter (where ${evalEntry.passed} = true)::int`,
				failedCount: sql<number>`count(*) filter (where ${evalEntry.passed} = false)::int`
			})
			.from(evalEntry)
			.where(inArray(evalEntry.runId, runIds))
			.groupBy(evalEntry.runId);

		const statsMap = new Map(stats.map((s) => [s.runId, s]));

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
			failedCount: statsMap.get(r.id)?.failedCount ?? 0
		}));
	});
}

export async function getLatestEvalRun(operatorUserId: string) {
	return withDbUser(operatorUserId, async (db) => {
		const [row] = await db
			.select()
			.from(evalRun)
			.where(eq(evalRun.userId, operatorUserId))
			.orderBy(desc(evalRun.createdAt))
			.limit(1);
		return row ?? null;
	});
}

export async function loadEvalRunDetail(
	operatorUserId: string,
	runId: string
): Promise<{ run: EvalRunSummary; entries: EvalEntrySummary[] } | null> {
	return withDbUser(operatorUserId, async (db) => {
		const [run] = await db.select().from(evalRun).where(eq(evalRun.id, runId));
		if (!run) return null;

		const entries = await db
			.select()
			.from(evalEntry)
			.where(eq(evalEntry.runId, runId))
			.orderBy(asc(evalEntry.ordinal));

		const passedCount = entries.filter((e) => e.passed === true).length;
		const failedCount = entries.filter((e) => e.passed === false).length;

		return {
			run: {
				id: run.id,
				label: run.label,
				scenarioId: run.scenarioId,
				status: run.status,
				evalUserId: run.evalUserId,
				startedAt: run.startedAt?.toISOString() ?? null,
				finishedAt: run.finishedAt?.toISOString() ?? null,
				error: run.error,
				synthesis: (run.synthesisJson as EvalSynthesis | null) ?? null,
				entryCount: entries.length,
				passedCount,
				failedCount
			},
			entries: entries.map((e) => ({
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
				result: (e.resultJson as Record<string, unknown> | null) ?? null
			}))
		};
	});
}

/** Bypass RLS for eval harness bootstrap (create ephemeral eval user row). */
export async function insertEvalUserRow(userId: string, name: string): Promise<void> {
	const { user } = await import('$lib/server/db/auth.schema');
	const db = getDb();
	const existing = await db.select().from(user).where(eq(user.id, userId));
	if (existing.length > 0) return;
	await db.insert(user).values({
		id: userId,
		name,
		email: `${userId}@local.eval`,
		emailVerified: true,
		onboardingCompleted: true
	});
}

export async function deleteEvalUserRow(userId: string): Promise<void> {
	const { user } = await import('$lib/server/db/auth.schema');
	const db = getDb();
	await db.delete(user).where(eq(user.id, userId));
}

export async function countRunsForOperator(operatorUserId: string): Promise<number> {
	return withDbUser(operatorUserId, async (db) => {
		const [row] = await db
			.select({ n: sql<number>`count(*)::int` })
			.from(evalRun)
			.where(eq(evalRun.userId, operatorUserId));
		return Number(row?.n ?? 0);
	});
}
