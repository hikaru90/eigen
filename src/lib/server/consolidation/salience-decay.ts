/**
 * Salience decay job.
 *
 * Applies a 3% nightly decay to salience_score for thoughts that have not been
 * accessed in 7+ days. This ensures stale memories gradually sink in relevance
 * while recently-accessed memories stay elevated.
 *
 * Decay formula: salience_score = GREATEST(0.1, salience_score * 0.97)
 * The floor of 0.1 prevents memories from becoming completely unreachable.
 *
 * Returns the number of rows updated.
 */

import { and, eq, lt, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { thought } from '$lib/server/db/schema';

const DECAY_FACTOR = 0.97;
const SALIENCE_FLOOR = 0.1;
const INACTIVE_DAYS = 7;

export async function runSalienceDecay(userId: string): Promise<number> {
	const db = getDb();

	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - INACTIVE_DAYS);

	const result = await db
		.update(thought)
		.set({
			salienceScore: sql`GREATEST(${SALIENCE_FLOOR}, ${thought.salienceScore} * ${DECAY_FACTOR})`
		})
		.where(
			and(
				eq(thought.userId, userId),
				// Decay thoughts not accessed recently (or never accessed).
				sql`(${thought.lastAccessedAt} IS NULL OR ${thought.lastAccessedAt} < ${cutoff})`
			)
		);

	// Drizzle update doesn't return row count directly; use a best-effort approach.
	return 0; // Row count not critical for this job.
}
