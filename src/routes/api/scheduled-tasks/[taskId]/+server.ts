import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consolidateForUser, formatConsolidationJobErrors } from '$lib/server/consolidation/runner';
import { SLEEP_CONSOLIDATION_TASK_ID } from '$lib/server/scheduled-tasks/constants';
import { setScheduledTaskPaused } from '$lib/server/scheduled-tasks/service';

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const taskId = params.taskId;
	if (!taskId) {
		error(400, 'taskId is required');
	}

	let body: { paused?: boolean };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}

	if (typeof body.paused !== 'boolean') {
		error(400, 'Body must include paused: boolean');
	}

	try {
		await setScheduledTaskPaused(taskId, body.paused);
		return json({ ok: true, paused: body.paused });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[scheduled-tasks] pause toggle failed', { taskId, message });
		return json({ ok: false, error: message }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) {
		error(401, 'Unauthorized');
	}

	const taskId = params.taskId;
	if (!taskId) {
		error(400, 'taskId is required');
	}

	if (taskId !== SLEEP_CONSOLIDATION_TASK_ID) {
		error(404, 'Unknown scheduled task');
	}

	try {
		const result = await consolidateForUser(locals.user.id);
		const errors = formatConsolidationJobErrors(result.jobs);
		return json({
			ok: errors.length === 0,
			result,
			errors,
			message:
				errors.length === 0
					? 'Heartbeat finished.'
					: `Finished with ${errors.length} step(s) reporting errors.`
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[scheduled-tasks] run now failed', { taskId, message });
		return json({ ok: false, error: message }, { status: 500 });
	}
};
