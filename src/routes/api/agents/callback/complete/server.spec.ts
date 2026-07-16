import { describe, expect, it, vi, beforeEach } from 'vitest';
import { POST } from './+server';

const { resolveConnectedAgentFromCallbackTokenMock, completeAgentAssignmentMock, withDbUserMock } =
	vi.hoisted(() => ({
		resolveConnectedAgentFromCallbackTokenMock: vi.fn(),
		completeAgentAssignmentMock: vi.fn(),
		withDbUserMock: vi.fn((_userId: string, fn: (db: unknown) => unknown) => fn({}))
	}));

vi.mock('$lib/server/agents/resolve-callback', () => ({
	resolveConnectedAgentFromCallbackToken: resolveConnectedAgentFromCallbackTokenMock
}));

vi.mock('$lib/server/agents/complete-assignment', () => ({
	completeAgentAssignment: completeAgentAssignmentMock
}));

vi.mock('$lib/server/db', () => ({
	withDbUser: withDbUserMock
}));

function event(overrides: { authHeader?: string | null; body?: unknown } = {}) {
	const headers = new Headers({ 'content-type': 'application/json' });
	if (overrides.authHeader !== null) {
		headers.set('authorization', overrides.authHeader ?? 'Bearer cb-token');
	}
	return {
		request: new Request('http://localhost/api/agents/callback/complete', {
			method: 'POST',
			headers,
			body: JSON.stringify(overrides.body ?? {})
		})
	} as Parameters<typeof POST>[0];
}

describe('POST /api/agents/callback/complete', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		withDbUserMock.mockImplementation((_userId: string, fn: (db: unknown) => unknown) => fn({}));
	});

	it('returns 401 when authorization header is missing', async () => {
		const res = await POST(event({ authHeader: null }));
		expect(res.status).toBe(401);
	});

	it('returns 401 when authorization header is malformed', async () => {
		const res = await POST(event({ authHeader: 'Basic abc' }));
		expect(res.status).toBe(401);
	});

	it('returns 401 when callback token does not resolve', async () => {
		resolveConnectedAgentFromCallbackTokenMock.mockResolvedValue(null);
		const res = await POST(event());
		expect(res.status).toBe(401);
	});

	it('returns 400 for invalid JSON body', async () => {
		resolveConnectedAgentFromCallbackTokenMock.mockResolvedValue({
			userId: 'u1',
			agentId: 'agent-1'
		});
		const res = await POST({
			request: new Request('http://localhost', {
				method: 'POST',
				headers: { authorization: 'Bearer cb-token' },
				body: 'not-json'
			})
		} as Parameters<typeof POST>[0]);
		expect(res.status).toBe(400);
	});

	it('returns 400 when assignmentId is missing', async () => {
		resolveConnectedAgentFromCallbackTokenMock.mockResolvedValue({
			userId: 'u1',
			agentId: 'agent-1'
		});
		const res = await POST(event({ body: { status: 'completed' } }));
		expect(res.status).toBe(400);
	});

	it('returns 400 when status is invalid', async () => {
		resolveConnectedAgentFromCallbackTokenMock.mockResolvedValue({
			userId: 'u1',
			agentId: 'agent-1'
		});
		const res = await POST(event({ body: { assignmentId: 'a1', status: 'pending' } }));
		expect(res.status).toBe(400);
	});

	it('completes the assignment', async () => {
		resolveConnectedAgentFromCallbackTokenMock.mockResolvedValue({
			userId: 'u1',
			agentId: 'agent-1'
		});
		completeAgentAssignmentMock.mockResolvedValue({ assignmentId: 'a1', status: 'completed' });
		const res = await POST(
			event({ body: { assignmentId: 'a1', status: 'completed', resultSummary: 'done' } })
		);
		expect(completeAgentAssignmentMock).toHaveBeenCalledWith({
			userId: 'u1',
			agentId: 'agent-1',
			assignmentId: 'a1',
			status: 'completed',
			resultSummary: 'done',
			captureText: undefined
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, assignmentId: 'a1', status: 'completed' });
	});

	it('returns 404 when assignment is not found', async () => {
		resolveConnectedAgentFromCallbackTokenMock.mockResolvedValue({
			userId: 'u1',
			agentId: 'agent-1'
		});
		completeAgentAssignmentMock.mockRejectedValue(new Error('assignment not found'));
		const res = await POST(event({ body: { assignmentId: 'a1', status: 'failed' } }));
		expect(res.status).toBe(404);
	});

	it('returns 409 when assignment is already in a terminal state', async () => {
		resolveConnectedAgentFromCallbackTokenMock.mockResolvedValue({
			userId: 'u1',
			agentId: 'agent-1'
		});
		completeAgentAssignmentMock.mockRejectedValue(new Error('assignment is already terminal'));
		const res = await POST(event({ body: { assignmentId: 'a1', status: 'failed' } }));
		expect(res.status).toBe(409);
	});
});
