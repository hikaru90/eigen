import { beforeEach, describe, expect, it, vi } from 'vitest';

const { pruneMock, repairMock, checkConnectionsMock, pruneDuplicateMock } = vi.hoisted(() => ({
	pruneMock: vi.fn(),
	repairMock: vi.fn(),
	checkConnectionsMock: vi.fn(),
	pruneDuplicateMock: vi.fn()
}));

vi.mock('$lib/server/consolidation/check-entity-graph-connections', () => ({
	checkEntityGraphConnectionsForUser: checkConnectionsMock
}));
vi.mock('$lib/server/consolidation/prune-duplicate-thought-relation-edges', () => ({
	pruneDuplicateThoughtRelationEdgesForUser: pruneDuplicateMock
}));
vi.mock('$lib/server/consolidation/prune-suspicious-entity-edges', () => ({
	pruneSuspiciousEntityEdgesForUser: pruneMock
}));
vi.mock('$lib/server/consolidation/repair-entity-relations', () => ({
	repairEntityRelationsForUser: repairMock
}));

import { POST } from './+server';

describe('POST /api/graph/rearrange', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		pruneMock.mockResolvedValue({ scanned: 1, removed: 0 });
		pruneDuplicateMock.mockResolvedValue({ scanned: 1, flagged: 0, removed: 0 });
		checkConnectionsMock.mockResolvedValue({ scanned: 1, flagged: 0, removed: 0 });
		repairMock.mockResolvedValue({
			scanned: 0,
			gaps: 0,
			processed: 0,
			repaired: 0,
			edgesAdded: 0,
			suspiciousEdgesRemoved: 0
		});
	});

	it('requires auth', async () => {
		await expect(POST({ locals: { user: null } } as never)).rejects.toMatchObject({
			status: 401
		});
	});

	it('runs prune and repair for any signed-in user', async () => {
		const res = await POST({
			locals: { user: { id: 'u1', email: 'a@b.com' } }
		} as never);
		expect(res.status).toBe(200);
		expect(pruneMock).toHaveBeenCalledWith('u1');
		expect(pruneDuplicateMock).toHaveBeenCalledWith('u1');
		expect(checkConnectionsMock).toHaveBeenCalledWith('u1');
		expect(repairMock).toHaveBeenCalledWith('u1');
	});
});
