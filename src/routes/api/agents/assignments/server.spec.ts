import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

const { listAgentTaskAssignmentsMock } = vi.hoisted(() => ({
	listAgentTaskAssignmentsMock: vi.fn()
}));

vi.mock('$lib/server/agents/service', () => ({
	listAgentTaskAssignments: listAgentTaskAssignmentsMock
}));

function event(user: { id: string } | null = { id: 'u1' }) {
	return { locals: { user } } as Parameters<typeof GET>[0];
}

describe('GET /api/agents/assignments', () => {
	it('returns 401 when unauthenticated', async () => {
		const res = await GET(event(null));
		expect(res.status).toBe(401);
	});

	it('lists task assignments for the user', async () => {
		listAgentTaskAssignmentsMock.mockResolvedValue([{ id: 'a1' }]);
		const res = await GET(event());
		expect(listAgentTaskAssignmentsMock).toHaveBeenCalledWith('u1');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ assignments: [{ id: 'a1' }] });
	});
});
