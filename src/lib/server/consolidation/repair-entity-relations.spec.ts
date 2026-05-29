import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	getDbMock,
	fetchEntityEdgesForUserMock,
	extractEntityTriplesMock,
	upsertEntityRelationTriplesMock,
	upsertEntityRelationEdgeMock
} = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	fetchEntityEdgesForUserMock: vi.fn(),
	extractEntityTriplesMock: vi.fn(),
	upsertEntityRelationTriplesMock: vi.fn(),
	upsertEntityRelationEdgeMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }));
vi.mock('$lib/server/graph/falkor', () => ({
	fetchEntityEdgesForUser: fetchEntityEdgesForUserMock,
	upsertEntityRelationEdge: upsertEntityRelationEdgeMock
}));
vi.mock('$lib/server/memory/entity-extraction', () => ({
	extractEntityTriples: extractEntityTriplesMock
}));
vi.mock('$lib/server/memory/entity-graph-sync', () => ({
	upsertEntityRelationTriples: upsertEntityRelationTriplesMock
}));

import { repairEntityRelationsForUser } from './repair-entity-relations';

describe('repairEntityRelationsForUser', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fetchEntityEdgesForUserMock.mockResolvedValue([]);
		extractEntityTriplesMock.mockResolvedValue([]);
		upsertEntityRelationTriplesMock.mockResolvedValue(0);
		upsertEntityRelationEdgeMock.mockResolvedValue(undefined);
	});

	it('connects obvious prefix pairs when triple extraction returns nothing', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					innerJoin: vi.fn(() => ({
						innerJoin: vi.fn(() => ({
							where: vi.fn(async () => [
								{
									thoughtId: 't1',
									canonicalEntityId: 'e-space',
									mentionSurface: 'Space',
									label: 'Space',
									canonicalKey: 'space',
									entityType: 'organization',
									normalizedText: 'Event at Space Hamburg in the Space network'
								},
								{
									thoughtId: 't1',
									canonicalEntityId: 'e-space-hamburg',
									mentionSurface: 'Space Hamburg',
									label: 'Space Hamburg',
									canonicalKey: 'space hamburg',
									entityType: 'place',
									normalizedText: 'Event at Space Hamburg in the Space network'
								}
							])
						}))
					}))
				}))
			}))
		});

		const result = await repairEntityRelationsForUser('u1');

		expect(result).toEqual({
			scanned: 1,
			gaps: 1,
			processed: 1,
			repaired: 1,
			edgesAdded: 1
		});
		expect(upsertEntityRelationEdgeMock).toHaveBeenCalledWith({
			userId: 'u1',
			sourceEntityId: 'e-space-hamburg',
			targetEntityId: 'e-space',
			predicate: 'part_of'
		});
	});

	it('reports all connected when co-mentioned entities already share edges', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					innerJoin: vi.fn(() => ({
						innerJoin: vi.fn(() => ({
							where: vi.fn(async () => [
								{
									thoughtId: 't1',
									canonicalEntityId: 'e-a',
									mentionSurface: 'A',
									label: 'A',
									canonicalKey: 'a',
									entityType: 'concept',
									normalizedText: 'A and B'
								},
								{
									thoughtId: 't1',
									canonicalEntityId: 'e-b',
									mentionSurface: 'B',
									label: 'B',
									canonicalKey: 'b',
									entityType: 'concept',
									normalizedText: 'A and B'
								}
							])
						}))
					}))
				}))
			}))
		});
		fetchEntityEdgesForUserMock.mockResolvedValue([{ sourceId: 'e-a', targetId: 'e-b', weight: 1 }]);

		const result = await repairEntityRelationsForUser('u1');

		expect(result).toEqual({
			scanned: 1,
			gaps: 0,
			processed: 0,
			repaired: 0,
			edgesAdded: 0
		});
		expect(extractEntityTriplesMock).not.toHaveBeenCalled();
		expect(upsertEntityRelationEdgeMock).not.toHaveBeenCalled();
	});
});
