import { describe, expect, it, vi } from 'vitest';
import { DELETE, PATCH, POST } from './+server';
import { SLEEP_CONSOLIDATION_TASK_ID } from '$lib/server/scheduled-tasks/constants';

const {
	setScheduledTaskPausedMock,
	startUserHeartbeatMock,
	cancelUserHeartbeatMock
} = vi.hoisted(() => ({
	setScheduledTaskPausedMock: vi.fn(),
	startUserHeartbeatMock: vi.fn(),
	cancelUserHeartbeatMock: vi.fn()
}));

vi.mock('$lib/server/scheduled-tasks/service', () => ({
	setScheduledTaskPaused: setScheduledTaskPausedMock
}));
vi.mock('$lib/server/consolidation/heartbeat-worker', () => ({
	startUserHeartbeat: startUserHeartbeatMock,
	cancelUserHeartbeat: cancelUserHeartbeatMock
}));

function patchRequest(body: unknown) {
	return new Request('http://localhost/api/scheduled-tasks/task', {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}

describe('PATCH /api/scheduled-tasks/[taskId]', () => {
	it('returns 401 when unauthenticated', async () => {
		await expect(
			PATCH({
				locals: { user: null },
				params: { taskId: 'task-1' },
				request: patchRequest({ paused: true })
			} as never)
		).rejects.toMatchObject({ status: 401 });
	});

	it('returns 400 for invalid JSON body', async () => {
		await expect(
			PATCH({
				locals: { user: { id: 'u1' } },
				params: { taskId: 'task-1' },
				request: new Request('http://localhost', { method: 'PATCH', body: 'not-json' })
			} as never)
		).rejects.toMatchObject({ status: 400 });
	});

	it('returns 400 when paused is not a boolean', async () => {
		await expect(
			PATCH({
				locals: { user: { id: 'u1' } },
				params: { taskId: 'task-1' },
				request: patchRequest({ paused: 'yes' })
			} as never)
		).rejects.toMatchObject({ status: 400 });
	});

	it('toggles pause state on success', async () => {
		setScheduledTaskPausedMock.mockResolvedValue(undefined);

		const res = await PATCH({
			locals: { user: { id: 'u1' } },
			params: { taskId: 'task-1' },
			request: patchRequest({ paused: true })
		} as never);

		expect(setScheduledTaskPausedMock).toHaveBeenCalledWith('task-1', true);
		expect(await res.json()).toEqual({ ok: true, paused: true });
	});

	it('returns 500 when pause toggle fails', async () => {
		setScheduledTaskPausedMock.mockRejectedValue(new Error('cron error'));
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const res = await PATCH({
			locals: { user: { id: 'u1' } },
			params: { taskId: 'task-1' },
			request: patchRequest({ paused: false })
		} as never);

		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ ok: false, error: 'cron error' });
		consoleSpy.mockRestore();
	});
});

describe('POST /api/scheduled-tasks/[taskId]', () => {
	it('returns 401 when unauthenticated', async () => {
		await expect(
			POST({
				locals: { user: null },
				params: { taskId: SLEEP_CONSOLIDATION_TASK_ID }
			} as never)
		).rejects.toMatchObject({ status: 401 });
	});

	it('returns 404 for unknown task', async () => {
		await expect(
			POST({
				locals: { user: { id: 'u1' } },
				params: { taskId: 'unknown-task' }
			} as never)
		).rejects.toMatchObject({ status: 404 });
	});

	it('returns 409 when heartbeat is already running', async () => {
		startUserHeartbeatMock.mockResolvedValue({
			started: false,
			runId: 'run-1',
			plannedJobs: 0
		});

		const res = await POST({
			locals: { user: { id: 'u1' } },
			params: { taskId: SLEEP_CONSOLIDATION_TASK_ID }
		} as never);

		expect(res.status).toBe(409);
		expect(await res.json()).toMatchObject({
			ok: false,
			runId: 'run-1',
			status: 'running'
		});
	});

	it('queues heartbeat and returns 202', async () => {
		startUserHeartbeatMock.mockResolvedValue({
			started: true,
			runId: 'run-2',
			plannedJobs: 3
		});

		const res = await POST({
			locals: { user: { id: 'u1' } },
			params: { taskId: SLEEP_CONSOLIDATION_TASK_ID }
		} as never);

		expect(res.status).toBe(202);
		expect(await res.json()).toEqual({
			ok: true,
			runId: 'run-2',
			plannedJobs: 3,
			status: 'running',
			message: 'Heartbeat queued.'
		});
	});
});

describe('DELETE /api/scheduled-tasks/[taskId]', () => {
	it('returns 401 when unauthenticated', async () => {
		await expect(
			DELETE({
				locals: { user: null },
				params: { taskId: SLEEP_CONSOLIDATION_TASK_ID }
			} as never)
		).rejects.toMatchObject({ status: 401 });
	});

	it('returns 404 for unknown task', async () => {
		await expect(
			DELETE({
				locals: { user: { id: 'u1' } },
				params: { taskId: 'unknown-task' }
			} as never)
		).rejects.toMatchObject({ status: 404 });
	});

	it('returns 404 when no heartbeat is running', async () => {
		cancelUserHeartbeatMock.mockResolvedValue(false);

		const res = await DELETE({
			locals: { user: { id: 'u1' } },
			params: { taskId: SLEEP_CONSOLIDATION_TASK_ID }
		} as never);

		expect(res.status).toBe(404);
		expect((await res.json()).error).toMatch(/No heartbeat/);
	});

	it('requests stop for running heartbeat', async () => {
		cancelUserHeartbeatMock.mockResolvedValue(true);

		const res = await DELETE({
			locals: { user: { id: 'u1' } },
			params: { taskId: SLEEP_CONSOLIDATION_TASK_ID }
		} as never);

		expect(cancelUserHeartbeatMock).toHaveBeenCalledWith('u1');
		expect(await res.json()).toEqual({
			ok: true,
			message: 'Stop requested — finishing current step.'
		});
	});
});
