import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { thought } from '$lib/server/db/schema';
import { deleteThoughtForUser } from '$lib/server/capture/service';
import { runWithTrace } from '$lib/server/activity/trace-context';

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const thoughtId = event.params.thoughtId?.trim() ?? '';
	if (!thoughtId) error(400, 'thoughtId is required');

	const [row] = await getDb()
		.select({
			id: thought.id,
			rawText: thought.rawText,
			normalizedText: thought.normalizedText,
			category: thought.category,
			metadata: thought.metadata,
			updatedAt: thought.updatedAt
		})
		.from(thought)
		.where(and(eq(thought.id, thoughtId), eq(thought.userId, user.id)))
		.limit(1);

	if (!row) error(404, 'Thought not found');

	return json(row);
};

export const DELETE: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const thoughtId = event.params.thoughtId?.trim() ?? '';
	if (!thoughtId) error(400, 'thoughtId is required');

	const result = await runWithTrace(crypto.randomUUID(), () =>
		deleteThoughtForUser(user.id, thoughtId)
	);
	if (!result.ok) error(404, 'Thought not found');

	return json({ ok: true as const });
};
