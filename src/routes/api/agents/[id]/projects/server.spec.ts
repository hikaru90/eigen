import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './+server';

const { listMock, bindMock } = vi.hoisted(() => ({
	listMock: vi.fn(),
	bindMock: vi.fn()
}));

vi.mock('$lib/server/agents/service', () => ({
	listAgentProjectBindings: listMock,
	bindAgentToProject: bindMock
}));

describe('/api/agents/[id]/projects', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		listMock.mockResolvedValue([{ projectEntityId: 'p1' }]);
		bindMock.mockResolvedValue({ ok: true });
	});

	it('GET returns 401 without session', async () => {
		const res = await GET({
			locals: { user: null },
			params: { id: 'a1' }
		} as never);
		expect(res.status).toBe(401);
	});

	it('GET lists bindings', async () => {
		const res = await GET({
			locals: { user: { id: 'u1' } },
			params: { id: 'a1' }
		} as never);
		expect(await res.json()).toEqual({ bindings: [{ projectEntityId: 'p1' }] });
	});

	it('POST requires projectEntityId', async () => {
		const res = await POST({
			locals: { user: { id: 'u1' } },
			params: { id: 'a1' },
			request: new Request('http://localhost', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({})
			})
		} as never);
		expect(res.status).toBe(400);
	});

	it('POST binds agent to project', async () => {
		const res = await POST({
			locals: { user: { id: 'u1' } },
			params: { id: 'a1' },
			request: new Request('http://localhost', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ projectEntityId: 'p1' })
			})
		} as never);
		expect(res.status).toBe(201);
		expect(bindMock).toHaveBeenCalledWith({
			userId: 'u1',
			agentId: 'a1',
			projectEntityId: 'p1'
		});
	});
});
