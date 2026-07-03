import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { shouldScheduleDevCaptureEnrichWorker } from '$lib/server/auth/harness-account';
import { listPendingEnrichThoughtIds } from '$lib/server/capture/enrich-pending';
import { scheduleCaptureEnrichWorker } from '$lib/server/capture/capture-enrich-worker';
import {
	recoverStaleEnrichProcessingRows,
	requeueOrphanedCompleteEnrichRows
} from '$lib/server/capture/queue-capture';

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	await recoverStaleEnrichProcessingRows(user.id);
	await requeueOrphanedCompleteEnrichRows(user.id);

	const thoughtIds = await listPendingEnrichThoughtIds(user.id);
	if (thoughtIds.length > 0 && (await shouldScheduleDevCaptureEnrichWorker(user.id))) {
		scheduleCaptureEnrichWorker(user.id);
	}
	return json({ thoughtIds });
};
