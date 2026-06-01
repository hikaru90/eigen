import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	getDbMock,
	fetchEntityEdgesForUserMock,
	deleteEntityRelationEdgeMock,
	loadOntologyForUserMock
} = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	fetchEntityEdgesForUserMock: vi.fn(),
	deleteEntityRelationEdgeMock: vi.fn(),
	loadOntologyForUserMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }));
vi.mock('$lib/server/graph/age', () => ({
	fetchEntityEdgesForUser: fetchEntityEdgesForUserMock,
	deleteEntityRelationEdge: deleteEntityRelationEdgeMock
}));
vi.mock('$lib/server/ontology-db/load-ontology', () => ({
	loadOntologyForUser: loadOntologyForUserMock
}));

import { checkEntityGraphConnectionsForUser } from './check-entity-graph-connections';

describe('checkEntityGraphConnectionsForUser', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		deleteEntityRelationEdgeMock.mockResolvedValue(undefined);
	});

	it('removes predicate edges whose source/target entity types are invalid for that relation kind', async () => {
		fetchEntityEdgesForUserMock.mockResolvedValue([
			{
				sourceId: 'e-source',
				targetId: 'e-target',
				weight: 1,
				predicate: 'located_in'
			}
		]);
		loadOntologyForUserMock.mockResolvedValue({
			entityKinds: [
				{ id: 'k-org', key: 'organization', kindType: 'entity_type', active: true },
				{ id: 'k-place', key: 'place', kindType: 'entity_type', active: true }
			],
			relationKinds: [
				{
					id: 'r1',
					key: 'located_in',
					active: true,
					fromOntologyEntityKindId: 'k-org',
					toOntologyEntityKindId: 'k-place'
				}
			],
			entityKindsById: new Map([
				['k-org', { id: 'k-org', key: 'organization', kindType: 'entity_type', active: true }],
				['k-place', { id: 'k-place', key: 'place', kindType: 'entity_type', active: true }]
			])
		});
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(async () => [
						{ id: 'e-source', entityType: 'organization' },
						{ id: 'e-target', entityType: 'concept' }
					])
				}))
			}))
		});

		const result = await checkEntityGraphConnectionsForUser('u1');

		expect(result).toEqual({ scanned: 1, flagged: 1, removed: 1 });
		expect(deleteEntityRelationEdgeMock).toHaveBeenCalledWith({
			userId: 'u1',
			sourceEntityId: 'e-source',
			targetEntityId: 'e-target',
			predicate: 'located_in'
		});
	});

	it('keeps valid typed relations and generic related_to edges', async () => {
		fetchEntityEdgesForUserMock.mockResolvedValue([
			{
				sourceId: 'e-source',
				targetId: 'e-target',
				weight: 1,
				predicate: 'located_in'
			},
			{
				sourceId: 'e-source',
				targetId: 'e-target',
				weight: 1,
				predicate: 'related_to'
			}
		]);
		loadOntologyForUserMock.mockResolvedValue({
			entityKinds: [
				{ id: 'k-org', key: 'organization', kindType: 'entity_type', active: true },
				{ id: 'k-place', key: 'place', kindType: 'entity_type', active: true }
			],
			relationKinds: [
				{
					id: 'r1',
					key: 'located_in',
					active: true,
					fromOntologyEntityKindId: 'k-org',
					toOntologyEntityKindId: 'k-place'
				}
			],
			entityKindsById: new Map([
				['k-org', { id: 'k-org', key: 'organization', kindType: 'entity_type', active: true }],
				['k-place', { id: 'k-place', key: 'place', kindType: 'entity_type', active: true }]
			])
		});
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(async () => [
						{ id: 'e-source', entityType: 'organization' },
						{ id: 'e-target', entityType: 'place' }
					])
				}))
			}))
		});

		const result = await checkEntityGraphConnectionsForUser('u1');

		expect(result).toEqual({ scanned: 2, flagged: 0, removed: 0 });
		expect(deleteEntityRelationEdgeMock).not.toHaveBeenCalled();
	});
});
