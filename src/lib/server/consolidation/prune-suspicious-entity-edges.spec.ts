import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDbMock, fetchEntityEdgesForUserMock, deleteEntityRelationEdgeMock } = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	fetchEntityEdgesForUserMock: vi.fn(),
	deleteEntityRelationEdgeMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }));
vi.mock('$lib/server/graph/age', () => ({
	fetchEntityEdgesForUser: fetchEntityEdgesForUserMock,
	deleteEntityRelationEdge: deleteEntityRelationEdgeMock
}));

import { pruneSuspiciousEntityEdgesForUser } from './prune-suspicious-entity-edges';

describe('pruneSuspiciousEntityEdgesForUser', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		deleteEntityRelationEdgeMock.mockResolvedValue(undefined);
	});

	it('removes unsupported related_to edges with weight 1', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(async () => [])
				}))
			}))
		});
		fetchEntityEdgesForUserMock.mockResolvedValue([
			{
				sourceId: 'e-a',
				targetId: 'e-b',
				weight: 1,
				predicate: 'related_to'
			}
		]);

		const result = await pruneSuspiciousEntityEdgesForUser('u1');

		expect(result).toEqual({ scanned: 1, removed: 1 });
		expect(deleteEntityRelationEdgeMock).toHaveBeenCalledWith({
			userId: 'u1',
			sourceEntityId: 'e-a',
			targetEntityId: 'e-b',
			predicate: 'related_to'
		});
	});

	it('keeps related_to edges backed by same-thought co-mention', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(async () => [
						{ thoughtId: 't1', entityId: 'e-a' },
						{ thoughtId: 't1', entityId: 'e-b' }
					])
				}))
			}))
		});
		fetchEntityEdgesForUserMock.mockResolvedValue([
			{
				sourceId: 'e-a',
				targetId: 'e-b',
				weight: 1,
				predicate: 'related_to'
			}
		]);

		const result = await pruneSuspiciousEntityEdgesForUser('u1');

		expect(result).toEqual({ scanned: 1, removed: 0 });
		expect(deleteEntityRelationEdgeMock).not.toHaveBeenCalled();
	});
});
