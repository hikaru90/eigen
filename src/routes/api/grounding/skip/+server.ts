import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { completeGroundingSession } from '$lib/server/grounding/profile';

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const result = await completeGroundingSession({ userId: user.id });
	return json({
		ok: true,
		redirectTo: result.redirectTo
	});
};
