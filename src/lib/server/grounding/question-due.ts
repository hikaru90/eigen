import { desc, eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { thought, userGroundingProfile } from '$lib/server/db/schema';
import {
	GROUNDING_QUESTION_CAPTURE_INTERVAL,
	GROUNDING_QUESTION_MIN_DAYS
} from '$lib/server/grounding/constants';
import { loadGroundingProfileRow } from '$lib/server/grounding/profile';

const MS_PER_DAY = 86_400_000;

export async function loadUserThoughtCount(userId: string): Promise<number> {
	const [row] = await getDb()
		.select({ count: sql<number>`count(*)::int` })
		.from(thought)
		.where(eq(thought.userId, userId));
	return row?.count ?? 0;
}

export async function isGroundingQuestionDue(
	userId: string,
	thoughtCountOverride?: number
): Promise<boolean> {
	const [thoughtCount, profile] = await Promise.all([
		thoughtCountOverride ?? loadUserThoughtCount(userId),
		loadGroundingProfileRow(userId)
	]);

	if (thoughtCount <= 0) return false;
	if (thoughtCount % GROUNDING_QUESTION_CAPTURE_INTERVAL !== 0) return false;

	const lastPrompt = profile?.lastSessionAt;
	if (lastPrompt) {
		const daysSince = (Date.now() - lastPrompt.getTime()) / MS_PER_DAY;
		if (daysSince < GROUNDING_QUESTION_MIN_DAYS) return false;
	}

	return true;
}

export async function loadRecentThoughtsForGroundingQuestion(
	userId: string,
	limit = 8
): Promise<Array<{ normalizedText: string; category: string }>> {
	return getDb()
		.select({ normalizedText: thought.normalizedText, category: thought.category })
		.from(thought)
		.where(eq(thought.userId, userId))
		.orderBy(desc(thought.createdAt), desc(thought.id))
		.limit(limit);
}

export async function touchGroundingQuestionPrompt(userId: string): Promise<void> {
	const now = new Date();
	const existing = await loadGroundingProfileRow(userId);
	const sessionCount = (existing?.sessionCount ?? 0) + 1;
	const facets = existing?.facets ?? {};

	await getDb()
		.insert(userGroundingProfile)
		.values({
			userId,
			facets,
			lastSessionAt: now,
			sessionCount
		})
		.onConflictDoUpdate({
			target: userGroundingProfile.userId,
			set: {
				lastSessionAt: now,
				sessionCount,
				updatedAt: now
			}
		});
}
