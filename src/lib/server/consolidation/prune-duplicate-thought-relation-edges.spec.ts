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

import { pruneDuplicateThoughtRelationEdgesForUser } from './prune-duplicate-thought-relation-edges';

describe('pruneDuplicateThoughtRelationEdgesForUser', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		deleteEntityRelationEdgeMock.mockResolvedValue(undefined);
	});

	it('removes weak related_to edges backed mostly by duplicate thought text', async () => {
		fetchEntityEdgesForUserMock.mockResolvedValue([
			{
				sourceId: 'e-schwester',
				targetId: 'e-alex',
				weight: 1,
				predicate: 'related_to'
			}
		]);
		getDbMock.mockReturnValue({
			execute: vi.fn(async () => [{ thought_count: 12, unique_text_count: 2 }])
		});

		const result = await pruneDuplicateThoughtRelationEdgesForUser('u1');

		expect(result).toEqual({ scanned: 1, flagged: 1, removed: 1 });
		expect(deleteEntityRelationEdgeMock).toHaveBeenCalledWith({
			userId: 'u1',
			sourceEntityId: 'e-schwester',
			targetEntityId: 'e-alex',
			predicate: 'related_to'
		});
	});

	it('keeps edges when support comes from non-duplicate thoughts', async () => {
		fetchEntityEdgesForUserMock.mockResolvedValue([
			{
				sourceId: 'e-a',
				targetId: 'e-b',
				weight: 1,
				predicate: 'related_to'
			}
		]);
		getDbMock.mockReturnValue({
			execute: vi.fn(async () => [{ thought_count: 6, unique_text_count: 5 }])
		});

		const result = await pruneDuplicateThoughtRelationEdgesForUser('u1');

		expect(result).toEqual({ scanned: 1, flagged: 0, removed: 0 });
		expect(deleteEntityRelationEdgeMock).not.toHaveBeenCalled();
	});
});
