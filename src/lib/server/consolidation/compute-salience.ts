/**
 * Time-based salience recompute (consolidation job).
 *
 * Idempotent: formulas depend on elapsed wall-clock time since last access / capture,
 * not on how many heartbeat runs occurred. Running twice in the same second yields
 * the same scores.
 *
 * - Inactive thoughts (7+ days since last access): exponential decay by elapsed days
 * - Unresolved open loops: salience floor rises with days since capture
 * - Exempt thoughts (fact/decision/preference, metadata.neverStale): skip decay
 */

import { and, eq, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { thought } from '$lib/server/db/schema';
import { NEVER_STALE_MEMORY_TYPES } from '$lib/server/memory/thought-staleness';

/** Daily decay multiplier per inactive day beyond the grace window. */
export const DECAY_FACTOR_PER_DAY = 0.97;
export const SALIENCE_FLOOR = 0.1;
export const SALIENCE_MAX = 5.0;
/** No decay until this many days without retrieval access. */
export const INACTIVE_GRACE_DAYS = 7;
/** Unresolved open-loop salience rises by this much per day since capture. */
export const OPEN_LOOP_RISE_PER_DAY = 0.15;

const EXEMPT_MEMORY_TYPES = [...NEVER_STALE_MEMORY_TYPES];

export type SalienceComputeResult = {
	decayed: number;
	openLoops: number;
};

function inactiveDaysSql() {
	return sql`GREATEST(0, EXTRACT(EPOCH FROM (NOW() - COALESCE(${thought.lastAccessedAt}, ${thought.createdAt}))) / 86400.0 - ${INACTIVE_GRACE_DAYS})`;
}

function openLoopDaysSql() {
	return sql`GREATEST(0, EXTRACT(EPOCH FROM (NOW() - ${thought.createdAt})) / 86400.0)`;
}

function salienceExemptFilter() {
	return and(
		or(isNull(thought.memoryType), notInArray(thought.memoryType, EXEMPT_MEMORY_TYPES)),
		sql`(${thought.metadata}->>'neverStale') IS DISTINCT FROM 'true'`
	);
}

export async function runSalienceCompute(userId: string): Promise<SalienceComputeResult> {
	const db = getDb();
	const graceCutoff = new Date();
	graceCutoff.setDate(graceCutoff.getDate() - INACTIVE_GRACE_DAYS);

	console.info('[consolidation.salience_compute] starting', { userId });

	try {
		const decayed = await db
			.update(thought)
			.set({
				salienceScore: sql`GREATEST(${SALIENCE_FLOOR}, ${thought.salienceScore} * POWER(${DECAY_FACTOR_PER_DAY}, ${inactiveDaysSql()}))`
			})
			.where(
				and(
					eq(thought.userId, userId),
					salienceExemptFilter(),
					or(isNull(thought.lastAccessedAt), lt(thought.lastAccessedAt, graceCutoff)),
					sql`${inactiveDaysSql()} > 0`
				)
			)
			.returning({ id: thought.id });

		const openLoops = await db
			.update(thought)
			.set({
				salienceScore: sql`LEAST(${SALIENCE_MAX}, GREATEST(${thought.salienceScore}, 1.0 + ${OPEN_LOOP_RISE_PER_DAY} * ${openLoopDaysSql()}))`
			})
			.where(
				and(
					eq(thought.userId, userId),
					eq(thought.memoryType, 'open_loop'),
					sql`(${thought.metadata}->>'status') IS DISTINCT FROM 'completed'`,
					sql`LEAST(${SALIENCE_MAX}, GREATEST(${thought.salienceScore}, 1.0 + ${OPEN_LOOP_RISE_PER_DAY} * ${openLoopDaysSql()})) <> ${thought.salienceScore}`
				)
			)
			.returning({ id: thought.id });

		const result = { decayed: decayed.length, openLoops: openLoops.length };
		console.info('[consolidation.salience_compute] finished', { userId, ...result });
		return result;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[consolidation.salience_compute] failed', { userId, message });
		throw err;
	}
}
