import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { computeTimelineStatsForUser } from '$lib/server/memory/timeline-stats';

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const stats = await computeTimelineStatsForUser(user.id);
	return json(stats);
};
