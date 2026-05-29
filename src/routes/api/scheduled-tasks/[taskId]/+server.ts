import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { SLEEP_CONSOLIDATION_TASK_ID } from '$lib/server/scheduled-tasks/constants';
import { setScheduledTaskPaused } from '$lib/server/scheduled-tasks/service';
import { cancelUserHeartbeat, startUserHeartbeat } from '$lib/server/consolidation/heartbeat-worker';

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
		const outcome = await startUserHeartbeat(locals.user.id);
		if (!outcome.started) {
			return json(
				{
					ok: false,
					error: 'A heartbeat is already running.',
					runId: outcome.runId,
					status: 'running'
				},
				{ status: 409 }
			);
		}
		return json(
			{
				ok: true,
				runId: outcome.runId,
				plannedJobs: outcome.plannedJobs,
				status: 'running',
				message: 'Heartbeat queued.'
			},
			{ status: 202 }
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[scheduled-tasks] run now failed', { taskId, message });
		return json({ ok: false, error: message }, { status: 500 });
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
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

	const cancelled = await cancelUserHeartbeat(locals.user.id);
	if (!cancelled) {
		return json({ ok: false, error: 'No heartbeat is running.' }, { status: 404 });
	}

	return json({ ok: true, message: 'Stop requested — finishing current step.' });
};
