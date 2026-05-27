/**
 * REM-phase job: keep unresolved open loops salient (procedural memory maintenance).
 *
 * Bumps salience for thoughts classified as open_loop that are below the cap.
 * Skips rows marked resolved in metadata (`metadata.resolvedAt` ISO string).
 */

import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { thought } from '$lib/server/db/schema';

const SALIENCE_MAX = 5.0;
const OPEN_LOOP_BOOST = 0.15;

export async function boostOpenLoopSalience(userId: string): Promise<number> {
	const db = getDb();

	const result = await db
		.update(thought)
		.set({
			salienceScore: sql`LEAST(${thought.salienceScore} + ${OPEN_LOOP_BOOST}, ${SALIENCE_MAX})`
		})
		.where(
			and(
				eq(thought.userId, userId),
				eq(thought.memoryType, 'open_loop'),
				sql`${thought.salienceScore} < ${SALIENCE_MAX}`,
				sql`(${thought.metadata}->>'resolvedAt') IS NULL`
			)
		)
		.returning({ id: thought.id });

	return result.length;
}
