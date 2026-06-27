import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteTemporalEventForUser } from '$lib/server/memory/temporal-event-service';
import { deleteThoughtForUser } from '$lib/server/capture/service';
import { thoughtIdFromOpenLoopItemId } from '$lib/server/memory/temporal-event-list';

export const DELETE: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const eventId = event.params.id?.trim();
	if (!eventId) error(400, 'Event id is required');

	try {
		// Handle open loops (which are thoughts, not temporal events)
		const thoughtId = thoughtIdFromOpenLoopItemId(eventId);
		if (thoughtId) {
			const result = await deleteThoughtForUser(user.id, thoughtId);
			if (!result.ok) {
				if (result.reason === 'not_found') error(404, 'Thought not found');
				error(400, result.reason);
			}
			return json({ ok: true, summary: 'Removed open loop.' });
		}

		const result = await deleteTemporalEventForUser(user.id, eventId);
		return json(result);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes('not found')) error(404, message);
		error(400, message);
	}
};
