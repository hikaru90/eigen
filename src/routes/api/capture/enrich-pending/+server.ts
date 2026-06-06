import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listPendingEnrichThoughtIds } from '$lib/server/capture/enrich-pending';
import { scheduleCaptureEnrichWorker } from '$lib/server/capture/capture-enrich-worker';

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const thoughtIds = await listPendingEnrichThoughtIds(user.id);
	if (thoughtIds.length > 0) {
		scheduleCaptureEnrichWorker(user.id);
	}
	return json({ thoughtIds });
};
