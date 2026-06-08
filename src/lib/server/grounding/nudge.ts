import { sql, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { thought } from '$lib/server/db/schema';
import {
	GROUNDING_REGROUND_DAYS,
	GROUNDING_REGROUND_THOUGHT_INTERVAL
} from '$lib/server/grounding/constants';
import type { GroundingProfileSnapshot } from '$lib/server/grounding/types';

const MS_PER_DAY = 86_400_000;

export async function shouldShowRegroundNudge(input: {
	userId: string;
	grounding: GroundingProfileSnapshot | null;
	dismissed?: boolean;
}): Promise<boolean> {
	if (input.dismissed) return false;
	if (!input.grounding?.initialCompletedAt) return false;

	const lastSession = input.grounding.lastSessionAt;
	if (lastSession) {
		const daysSince = (Date.now() - lastSession.getTime()) / MS_PER_DAY;
		if (daysSince >= GROUNDING_REGROUND_DAYS) return true;
	}

	const [row] = await getDb()
		.select({ count: sql<number>`count(*)::int` })
		.from(thought)
		.where(eq(thought.userId, input.userId));

	const thoughtCount = row?.count ?? 0;
	if (
		thoughtCount > 0 &&
		thoughtCount % GROUNDING_REGROUND_THOUGHT_INTERVAL === 0
	) {
		return true;
	}

	return false;
}
