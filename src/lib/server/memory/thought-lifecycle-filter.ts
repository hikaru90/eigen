import { and, eq, or, sql } from 'drizzle-orm';
import { thought } from '$lib/server/db/schema';

/** Only open thoughts participate in retrieval and active browse lists. */
export function activeThoughtLifecycleCondition() {
	return and(
		eq(thought.lifecycleStatus, 'open'),
		or(
			sql`${thought.metadata}->>'status' IS NULL`,
			sql`${thought.metadata}->>'status' NOT IN ('completed', 'archived')`
		)
	);
}
