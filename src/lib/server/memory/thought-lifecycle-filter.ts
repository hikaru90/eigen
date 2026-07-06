import { eq } from 'drizzle-orm';
import { thought } from '$lib/server/db/schema';

/** Only open thoughts participate in retrieval and active browse lists. */
export function activeThoughtLifecycleCondition() {
	return eq(thought.lifecycleStatus, 'open');
}
