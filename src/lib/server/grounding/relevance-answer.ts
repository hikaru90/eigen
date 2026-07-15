import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { thought } from '$lib/server/db/schema';
import {
	RELEVANCE_CHECKIN_KEEP_SALIENCE_BOOST,
	RELEVANCE_CHECKIN_SALIENCE_MAX
} from '$lib/server/grounding/constants';
import { archiveThoughtForUser } from '$lib/server/memory/lifecycle';

export type RelevanceCheckInAction = 'keep' | 'archive';

export type RelevanceCheckInAnswerResult =
	| { ok: true; action: 'keep' }
	| { ok: true; action: 'archive' }
	| { ok: false; reason: 'not_found' | 'invalid_action' };

/** Soft reconsolidation when the user says a faded thought is still relevant. */
export async function keepThoughtForRelevanceCheckIn(
	userId: string,
	thoughtId: string
): Promise<{ ok: true } | { ok: false; reason: 'not_found' }> {
	const now = new Date();
	const [updated] = await getDb()
		.update(thought)
		.set({
			accessCount: sql`${thought.accessCount} + 1`,
			lastAccessedAt: now,
			salienceScore: sql`LEAST(${thought.salienceScore} + ${RELEVANCE_CHECKIN_KEEP_SALIENCE_BOOST}, ${RELEVANCE_CHECKIN_SALIENCE_MAX})`,
			updatedAt: now
		})
		.where(
			and(eq(thought.id, thoughtId), eq(thought.userId, userId), eq(thought.lifecycleStatus, 'open'))
		)
		.returning({ id: thought.id });

	if (!updated) return { ok: false, reason: 'not_found' };
	return { ok: true };
}

export async function applyRelevanceCheckInAnswer(input: {
	userId: string;
	thoughtId: string;
	action: RelevanceCheckInAction;
}): Promise<RelevanceCheckInAnswerResult> {
	if (input.action === 'keep') {
		const kept = await keepThoughtForRelevanceCheckIn(input.userId, input.thoughtId);
		if (!kept.ok) return kept;
		return { ok: true, action: 'keep' };
	}

	if (input.action === 'archive') {
		const archived = await archiveThoughtForUser(input.userId, input.thoughtId);
		if (!archived.ok) return { ok: false, reason: 'not_found' };
		return { ok: true, action: 'archive' };
	}

	return { ok: false, reason: 'invalid_action' };
}
