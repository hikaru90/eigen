import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	deleteCanonicalEntityForUser,
	getCanonicalEntityForUser,
	listThoughtsMentioningCanonicalEntity,
	repairCanonicalEntityTypesForUser,
	syncCanonicalEntityVertexToGraph,
	updateCanonicalEntityForUser
} from './canonical-entity-admin';

const {
	getDbMock,
	upsertEntityNodeMock,
	upsertMentionEdgeMock,
	deleteEntityVertexFromGraphMock,
	ensureUserOntologySeededMock,
	ensureEntityTypeKindsSeededMock,
	loadOntologyForUserMock,
	activeEntityTypeKindKeysMock
} = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	upsertEntityNodeMock: vi.fn(),
	upsertMentionEdgeMock: vi.fn(),
	deleteEntityVertexFromGraphMock: vi.fn(),
	ensureUserOntologySeededMock: vi.fn(),
	ensureEntityTypeKindsSeededMock: vi.fn(),
	loadOntologyForUserMock: vi.fn(),
	activeEntityTypeKindKeysMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({ getDb: getDbMock }));
vi.mock('$lib/server/graph/age', () => ({
	upsertEntityNode: upsertEntityNodeMock,
	upsertMentionEdge: upsertMentionEdgeMock,
	deleteEntityVertexFromGraph: deleteEntityVertexFromGraphMock
}));
vi.mock('$lib/server/ontology-db', () => ({
	ensureUserOntologySeeded: ensureUserOntologySeededMock,
	ensureEntityTypeKindsSeeded: ensureEntityTypeKindsSeededMock,
	loadOntologyForUser: loadOntologyForUserMock,
	activeEntityTypeKindKeys: activeEntityTypeKindKeysMock,
	DEFAULT_ENTITY_TYPE_KIND_KEYS: ['concept', 'person', 'place']
}));

const entityRow = {
	id: 'ent-1',
	label: 'Sam',
	entityType: 'person',
	canonicalKey: 'sam'
};

function chainLimit(rows: unknown[]) {
	return { limit: vi.fn(async () => rows) };
}

function chainOrderLimit(rows: unknown[]) {
	return {
		orderBy: vi.fn(() => chainLimit(rows))
	};
}

describe('canonical-entity-admin', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		ensureUserOntologySeededMock.mockResolvedValue(undefined);
		ensureEntityTypeKindsSeededMock.mockResolvedValue(undefined);
		loadOntologyForUserMock.mockResolvedValue({});
		activeEntityTypeKindKeysMock.mockReturnValue(new Set(['person', 'place', 'concept']));
		upsertEntityNodeMock.mockResolvedValue(undefined);
		upsertMentionEdgeMock.mockResolvedValue(undefined);
		deleteEntityVertexFromGraphMock.mockResolvedValue(undefined);
	});

	it('listThoughtsMentioningCanonicalEntity returns [] when no resolution links exist', async () => {
		const where = vi.fn(async () => []);
		getDbMock.mockReturnValue({
			selectDistinct: vi.fn(() => ({
				from: vi.fn(() => ({ where }))
			}))
		});

		const rows = await listThoughtsMentioningCanonicalEntity('u1', 'entity-1');
		expect(rows).toEqual([]);
	});

	it('listThoughtsMentioningCanonicalEntity loads linked thoughts', async () => {
		const thoughtRows = [{ id: 't1', normalizedText: 'Met Sam' }];
		getDbMock
			.mockReturnValueOnce({
				selectDistinct: vi.fn(() => ({
					from: vi.fn(() => ({
						where: vi.fn(async () => [{ thoughtId: 't1' }])
					}))
				}))
			})
			.mockReturnValueOnce({
				select: vi.fn(() => ({
					from: vi.fn(() => ({
						where: vi.fn(() => chainOrderLimit(thoughtRows))
					}))
				}))
			});

		const rows = await listThoughtsMentioningCanonicalEntity('u1', 'entity-1');
		expect(rows).toEqual(thoughtRows);
	});

	it('getCanonicalEntityForUser returns null when entity is missing', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => chainLimit([]))
				}))
			}))
		});

		await expect(getCanonicalEntityForUser('u1', 'missing')).resolves.toBeNull();
	});

	it('updateCanonicalEntityForUser updates label and syncs graph', async () => {
		getDbMock
			.mockReturnValueOnce({
				select: vi.fn(() => ({
					from: vi.fn(() => ({
						where: vi.fn(() => chainLimit([entityRow]))
					}))
				}))
			})
			.mockReturnValueOnce({
				update: vi.fn(() => ({
					set: vi.fn(() => ({
						where: vi.fn(async () => undefined)
					}))
				}))
			})
			.mockReturnValueOnce({
				select: vi.fn(() => ({
					from: vi.fn(() => ({
						where: vi.fn(() => chainLimit([{ ...entityRow, label: 'Samuel' }]))
					}))
				}))
			});

		const result = await updateCanonicalEntityForUser('u1', 'ent-1', { label: 'Samuel' });
		expect(result).toEqual({
			ok: true,
			entity: expect.objectContaining({ label: 'Samuel' })
		});
		expect(upsertEntityNodeMock).toHaveBeenCalled();
	});

	it('syncCanonicalEntityVertexToGraph returns not_found for missing entity', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => chainLimit([]))
				}))
			}))
		});

		await expect(syncCanonicalEntityVertexToGraph('u1', 'missing')).resolves.toEqual({
			ok: false,
			reason: 'not_found'
		});
	});

	it('syncCanonicalEntityVertexToGraph reattaches mention edges for linked thoughts', async () => {
		getDbMock
			.mockReturnValueOnce({
				select: vi.fn(() => ({
					from: vi.fn(() => ({
						where: vi.fn(() => chainLimit([entityRow]))
					}))
				}))
			})
			.mockReturnValueOnce({
				selectDistinct: vi.fn(() => ({
					from: vi.fn(() => ({
						where: vi.fn(async () => [{ thoughtId: 't1' }, { thoughtId: 't2' }])
					}))
				}))
			});

		await expect(syncCanonicalEntityVertexToGraph('u1', 'ent-1')).resolves.toEqual({ ok: true });
		expect(upsertEntityNodeMock).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'ent-1', userId: 'u1' })
		);
		expect(upsertMentionEdgeMock).toHaveBeenNthCalledWith(1, {
			userId: 'u1',
			thoughtId: 't1',
			entityId: 'ent-1'
		});
		expect(upsertMentionEdgeMock).toHaveBeenNthCalledWith(2, {
			userId: 'u1',
			thoughtId: 't2',
			entityId: 'ent-1'
		});
	});

	it('deleteCanonicalEntityForUser removes graph vertex and postgres row', async () => {
		getDbMock
			.mockReturnValueOnce({
				select: vi.fn(() => ({
					from: vi.fn(() => ({
						where: vi.fn(() => chainLimit([entityRow]))
					}))
				}))
			})
			.mockReturnValueOnce({
				delete: vi.fn(() => ({
					where: vi.fn(async () => undefined)
				}))
			});

		await expect(deleteCanonicalEntityForUser('u1', 'ent-1')).resolves.toEqual({ ok: true });
		expect(deleteEntityVertexFromGraphMock).toHaveBeenCalledWith({
			userId: 'u1',
			entityId: 'ent-1'
		});
	});

	it('repairCanonicalEntityTypesForUser returns zero when nothing is stale', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(async () => [])
				}))
			}))
		});

		await expect(repairCanonicalEntityTypesForUser('u1')).resolves.toEqual({ repaired: 0 });
	});

	it('repairCanonicalEntityTypesForUser rewrites stale entity types', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(async () => [
						{
							id: 'ent-1',
							canonicalKey: 'sam',
							label: 'Sam',
							entityType: 'legacy_type'
						}
					])
				}))
			})),
			update: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(async () => undefined)
				}))
			}))
		});

		await expect(repairCanonicalEntityTypesForUser('u1')).resolves.toEqual({ repaired: 1 });
		expect(upsertEntityNodeMock).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'ent-1', entityType: 'concept' })
		);
	});
});
