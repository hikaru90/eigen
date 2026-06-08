import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { planWeekForUser } from '$lib/server/memory/plan-week';

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const result = await planWeekForUser(user.id);
	return json(result);
};
