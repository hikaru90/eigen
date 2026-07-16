import { describe, expect, it, vi } from 'vitest';
import { DELETE, PATCH } from './+server';

const { deleteConnectedAgentMock, replaceAgentProjectBindingsMock, updateConnectedAgentMock } =
	vi.hoisted(() => ({
		deleteConnectedAgentMock: vi.fn(),
		replaceAgentProjectBindingsMock: vi.fn(),
		updateConnectedAgentMock: vi.fn()
	}));

vi.mock('$lib/server/agents/service', () => ({
	deleteConnectedAgent: deleteConnectedAgentMock,
	replaceAgentProjectBindings: replaceAgentProjectBindingsMock,
	parseSubscribedEvents: vi.fn((v: unknown) => (Array.isArray(v) ? v : [])),
	updateConnectedAgent: updateConnectedAgentMock
}));

function patchEvent(overrides: { user?: { id: string } | null; body?: unknown } = {}) {
	return {
		locals: { user: overrides.user === undefined ? { id: 'u1' } : overrides.user },
		params: { id: 'agent-1' },
		request: new Request('http://localhost/api/agents/agent-1', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(overrides.body ?? {})
		})
	} as Parameters<typeof PATCH>[0];
}

function deleteEvent(user: { id: string } | null = { id: 'u1' }) {
	return { locals: { user }, params: { id: 'agent-1' } } as Parameters<typeof DELETE>[0];
}

describe('PATCH /api/agents/[id]', () => {
	it('returns 401 when unauthenticated', async () => {
		const res = await PATCH(patchEvent({ user: null }));
		expect(res.status).toBe(401);
	});

	it('updates agent fields', async () => {
		updateConnectedAgentMock.mockResolvedValue({ id: 'agent-1' });
		const res = await PATCH(patchEvent({ body: { name: 'Renamed', enabled: false } }));
		expect(updateConnectedAgentMock).toHaveBeenCalledWith({
			userId: 'u1',
			agentId: 'agent-1',
			name: 'Renamed',
			enabled: false
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ id: 'agent-1', ok: true });
	});

	it('replaces project bindings when provided', async () => {
		updateConnectedAgentMock.mockResolvedValue({ id: 'agent-1' });
		replaceAgentProjectBindingsMock.mockResolvedValue(undefined);
		await PATCH(patchEvent({ body: { projectEntityIds: ['p1', 'p2', ''] } }));
		expect(replaceAgentProjectBindingsMock).toHaveBeenCalledWith({
			userId: 'u1',
			agentId: 'agent-1',
			projectEntityIds: ['p1', 'p2']
		});
	});

	it('returns 404 when update fails with not found', async () => {
		updateConnectedAgentMock.mockRejectedValue(new Error('agent not found'));
		const res = await PATCH(patchEvent({ body: { name: 'x' } }));
		expect(res.status).toBe(404);
	});

	it('returns 400 when update fails otherwise', async () => {
		updateConnectedAgentMock.mockRejectedValue(new Error('invalid webhook url'));
		const res = await PATCH(patchEvent({ body: { webhookUrl: 'bad' } }));
		expect(res.status).toBe(400);
	});
});

describe('DELETE /api/agents/[id]', () => {
	it('returns 401 when unauthenticated', async () => {
		const res = await DELETE(deleteEvent(null));
		expect(res.status).toBe(401);
	});

	it('deletes the agent', async () => {
		deleteConnectedAgentMock.mockResolvedValue(undefined);
		const res = await DELETE(deleteEvent());
		expect(deleteConnectedAgentMock).toHaveBeenCalledWith('u1', 'agent-1');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	it('returns 404 when deletion fails', async () => {
		deleteConnectedAgentMock.mockRejectedValue(new Error('agent not found'));
		const res = await DELETE(deleteEvent());
		expect(res.status).toBe(404);
	});
});
