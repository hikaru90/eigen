import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	consolidateCanonicalEntityAliasesForUser,
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

const EMBEDDING_DIMENSIONS = 1536;

function fakeEmbedding(offset = 0): number[] {
	return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i + offset) * 0.0001);
}

function chainLimit(rows: unknown[]) {
	return { limit: vi.fn(async () => rows) };
}

function chainOrderLimit(rows: unknown[]) {
	return {
		orderBy: vi.fn(() => chainLimit(rows))
	};
}

type SelectResult = unknown[] | { throw: unknown };

/**
 * Queues rows for successive `db.select(...).from(...).where()` chains that end in
 * `.limit()` or `.orderBy().limit()`.
 */
function buildQueuedDb(config: {
	selects: SelectResult[];
	selectDistinct?: unknown[][];
	update?: boolean;
	insertOnConflict?: boolean;
	delete?: boolean;
}) {
	let selectIdx = 0;
	let selectDistinctIdx = 0;

	const takeSelect = () => {
		const next = config.selects[selectIdx] ?? [];
		selectIdx += 1;
		if (next && typeof next === 'object' && !Array.isArray(next) && 'throw' in next) {
			throw next.throw;
		}
		return next as unknown[];
	};

	const whereChain = () => ({
		limit: vi.fn(async () => takeSelect()),
		orderBy: vi.fn(() => ({
			limit: vi.fn(async () => takeSelect())
		}))
	});

	const db: Record<string, unknown> = {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => whereChain())
			}))
		}))
	};

	if (config.selectDistinct) {
		db.selectDistinct = vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(async () => {
					const rows = config.selectDistinct?.[selectDistinctIdx] ?? [];
					selectDistinctIdx += 1;
					return rows;
				})
			}))
		}));
	}

	if (config.update) {
		db.update = vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(async () => undefined)
			}))
		}));
	}

	if (config.insertOnConflict) {
		db.insert = vi.fn(() => ({
			values: vi.fn(() => ({
				onConflictDoNothing: vi.fn(async () => undefined)
			}))
		}));
	}

	if (config.delete) {
		db.delete = vi.fn(() => ({
			where: vi.fn(async () => undefined)
		}));
	}

	return db;
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

	it('updateCanonicalEntityForUser rejects empty label', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => chainLimit([entityRow]))
				}))
			}))
		});

		await expect(updateCanonicalEntityForUser('u1', 'ent-1', { label: '   ' })).rejects.toThrow(
			/non-empty/
		);
	});

	it('updateCanonicalEntityForUser rejects inactive entityType', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => chainLimit([entityRow]))
				}))
			}))
		});

		await expect(
			updateCanonicalEntityForUser('u1', 'ent-1', { entityType: 'not_a_real_type' })
		).rejects.toThrow(/active entity type kind key/);
	});

	it('consolidateCanonicalEntityAliasesForUser returns early with fewer than two embeddings', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => chainOrderLimit([{ id: 'e1', embedding: [1], createdAt: new Date() }]))
				}))
			}))
		});

		await expect(consolidateCanonicalEntityAliasesForUser('u1')).resolves.toEqual({
			scanned: 1,
			candidates: 0,
			merged: 0
		});
	});

	it('consolidateCanonicalEntityAliasesForUser skips invalid embeddings', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() =>
						chainOrderLimit([
							{
								id: 'e1',
								canonicalKey: 'bad',
								entityType: 'person',
								embedding: [1, 2, 3],
								createdAt: new Date()
							},
							{
								id: 'e2',
								canonicalKey: 'also-bad',
								entityType: 'person',
								embedding: [4, 5, 6],
								createdAt: new Date()
							}
						])
					)
				}))
			}))
		});

		await expect(consolidateCanonicalEntityAliasesForUser('u1')).resolves.toEqual({
			scanned: 2,
			candidates: 0,
			merged: 0
		});
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

	it('getCanonicalEntityForUser returns the entity row when present', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => chainLimit([entityRow]))
				}))
			}))
		});

		await expect(getCanonicalEntityForUser('u1', 'ent-1')).resolves.toEqual(entityRow);
	});

	it('listThoughtsMentioningCanonicalEntity filters empty thoughtId links', async () => {
		getDbMock.mockReturnValue({
			selectDistinct: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(async () => [{ thoughtId: '' }])
				}))
			}))
		});

		await expect(listThoughtsMentioningCanonicalEntity('u1', 'entity-1')).resolves.toEqual([]);
	});

	it('updateCanonicalEntityForUser returns not_found when entity is missing', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => chainLimit([]))
				}))
			}))
		});

		await expect(updateCanonicalEntityForUser('u1', 'missing', { label: 'X' })).resolves.toEqual({
			ok: false,
			reason: 'not_found'
		});
	});

	it('updateCanonicalEntityForUser returns not_found when re-fetch fails after update', async () => {
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
						where: vi.fn(() => chainLimit([]))
					}))
				}))
			});

		await expect(updateCanonicalEntityForUser('u1', 'ent-1', { label: 'Samuel' })).resolves.toEqual({
			ok: false,
			reason: 'not_found'
		});
	});

	it('updateCanonicalEntityForUser rejects empty entityType when provided', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => chainLimit([entityRow]))
				}))
			}))
		});

		await expect(updateCanonicalEntityForUser('u1', 'ent-1', { entityType: '   ' })).rejects.toThrow(
			/cannot be empty when provided/
		);
	});

	it('updateCanonicalEntityForUser updates entityType and syncs graph', async () => {
		const updatedRow = { ...entityRow, entityType: 'place' };
		getDbMock.mockReturnValue({
			select: vi
				.fn()
				.mockImplementationOnce(() => ({
					from: vi.fn(() => ({
						where: vi.fn(() => chainLimit([entityRow]))
					}))
				}))
				.mockImplementationOnce(() => ({
					from: vi.fn(() => ({
						where: vi.fn(() => chainLimit([updatedRow]))
					}))
				})),
			update: vi.fn(() => ({
				set: vi.fn(() => ({
					where: vi.fn(async () => undefined)
				}))
			}))
		});

		const result = await updateCanonicalEntityForUser('u1', 'ent-1', { entityType: 'place' });
		expect(result).toEqual({
			ok: true,
			entity: expect.objectContaining({ entityType: 'place' })
		});
		expect(ensureUserOntologySeededMock).toHaveBeenCalled();
		expect(upsertEntityNodeMock).toHaveBeenCalledWith(
			expect.objectContaining({ entityType: 'place' })
		);
	});

	it('syncCanonicalEntityVertexToGraph skips mention rows with empty thoughtId', async () => {
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
						where: vi.fn(async () => [{ thoughtId: '' }, { thoughtId: 't1' }])
					}))
				}))
			});

		await expect(syncCanonicalEntityVertexToGraph('u1', 'ent-1')).resolves.toEqual({ ok: true });
		expect(upsertMentionEdgeMock).toHaveBeenCalledTimes(1);
		expect(upsertMentionEdgeMock).toHaveBeenCalledWith({
			userId: 'u1',
			thoughtId: 't1',
			entityId: 'ent-1'
		});
	});

	it('deleteCanonicalEntityForUser returns not_found when entity is missing', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => chainLimit([]))
				}))
			}))
		});

		await expect(deleteCanonicalEntityForUser('u1', 'missing')).resolves.toEqual({
			ok: false,
			reason: 'not_found'
		});
	});

	it('repairCanonicalEntityTypesForUser throws when no active entity types exist', async () => {
		activeEntityTypeKindKeysMock.mockReturnValue(new Set());

		await expect(repairCanonicalEntityTypesForUser('u1')).rejects.toThrow(
			/no active entity type kinds/
		);
	});

	it('repairCanonicalEntityTypesForUser falls back to default active type when concept is inactive', async () => {
		activeEntityTypeKindKeysMock.mockReturnValue(new Set(['person']));
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(async () => [
						{
							id: 'ent-2',
							canonicalKey: 'berlin',
							label: 'Berlin',
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
			expect.objectContaining({ id: 'ent-2', entityType: 'person' })
		);
	});

	it('repairCanonicalEntityTypesForUser falls back to sorted active key when no defaults match', async () => {
		activeEntityTypeKindKeysMock.mockReturnValue(new Set(['zebra', 'alpha']));
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(async () => [
						{
							id: 'ent-3',
							canonicalKey: 'misc',
							label: 'Misc',
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
			expect.objectContaining({ id: 'ent-3', entityType: 'alpha' })
		);
	});

	it('consolidateCanonicalEntityAliasesForUser filters non-array embeddings from scan', async () => {
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() =>
						chainOrderLimit([
							{
								id: 'e1',
								canonicalKey: 'a',
								entityType: 'person',
								embedding: 'not-an-array',
								createdAt: new Date('2024-01-01')
							},
							{
								id: 'e2',
								canonicalKey: 'b',
								entityType: 'person',
								embedding: fakeEmbedding(),
								createdAt: new Date('2024-01-02')
							}
						])
					)
				}))
			}))
		});

		await expect(consolidateCanonicalEntityAliasesForUser('u1')).resolves.toEqual({
			scanned: 1,
			candidates: 0,
			merged: 0
		});
	});

	it('consolidateCanonicalEntityAliasesForUser skips non-finite embedding values', async () => {
		const bad = fakeEmbedding();
		bad[10] = Number.NaN;
		getDbMock.mockReturnValue({
			select: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() =>
						chainOrderLimit([
							{
								id: 'e1',
								canonicalKey: 'a',
								entityType: 'person',
								embedding: bad,
								createdAt: new Date('2024-01-01')
							},
							{
								id: 'e2',
								canonicalKey: 'b',
								entityType: 'person',
								embedding: fakeEmbedding(1),
								createdAt: new Date('2024-01-02')
							}
						])
					)
				}))
			}))
		});

		await expect(consolidateCanonicalEntityAliasesForUser('u1')).resolves.toEqual({
			scanned: 2,
			candidates: 0,
			merged: 0
		});
	});

	it('consolidateCanonicalEntityAliasesForUser skips when no nearest neighbor is found', async () => {
		const db = buildQueuedDb({
			selects: [
				[
					{
						id: 'e1',
						canonicalKey: 'sam',
						entityType: 'person',
						embedding: fakeEmbedding(),
						createdAt: new Date('2024-01-01')
					},
					{
						id: 'e2',
						canonicalKey: 'samuel',
						entityType: 'person',
						embedding: fakeEmbedding(1),
						createdAt: new Date('2024-01-02')
					}
				],
				[]
			]
		});
		getDbMock.mockReturnValue(db);

		await expect(consolidateCanonicalEntityAliasesForUser('u1')).resolves.toEqual({
			scanned: 2,
			candidates: 0,
			merged: 0
		});
	});

	it('consolidateCanonicalEntityAliasesForUser skips when nearest distance exceeds threshold', async () => {
		const db = buildQueuedDb({
			selects: [
				[
					{
						id: 'e1',
						canonicalKey: 'sam',
						entityType: 'person',
						embedding: fakeEmbedding(),
						createdAt: new Date('2024-01-01')
					},
					{
						id: 'e2',
						canonicalKey: 'samuel',
						entityType: 'person',
						embedding: fakeEmbedding(1),
						createdAt: new Date('2024-01-02')
					}
				],
				[
					{
						id: 'e2',
						canonicalKey: 'samuel',
						entityType: 'person',
						createdAt: new Date('2024-01-02'),
						distance: 0.5
					}
				]
			]
		});
		getDbMock.mockReturnValue(db);

		await expect(consolidateCanonicalEntityAliasesForUser('u1')).resolves.toEqual({
			scanned: 2,
			candidates: 0,
			merged: 0
		});
	});

	it('consolidateCanonicalEntityAliasesForUser skips when nearest distance is not numeric', async () => {
		const db = buildQueuedDb({
			selects: [
				[
					{
						id: 'e1',
						canonicalKey: 'sam',
						entityType: 'person',
						embedding: fakeEmbedding(),
						createdAt: new Date('2024-01-01')
					},
					{
						id: 'e2',
						canonicalKey: 'samuel',
						entityType: 'person',
						embedding: fakeEmbedding(1),
						createdAt: new Date('2024-01-02')
					}
				],
				[
					{
						id: 'e2',
						canonicalKey: 'samuel',
						entityType: 'person',
						createdAt: new Date('2024-01-02'),
						distance: '0.01'
					}
				]
			]
		});
		getDbMock.mockReturnValue(db);

		await expect(consolidateCanonicalEntityAliasesForUser('u1')).resolves.toEqual({
			scanned: 2,
			candidates: 0,
			merged: 0
		});
	});

	it('consolidateCanonicalEntityAliasesForUser merges duplicates keeping older entity as primary', async () => {
		const primaryRow = {
			id: 'e1',
			label: 'Sam',
			entityType: 'person',
			canonicalKey: 'sam'
		};
		const db = buildQueuedDb({
			selects: [
				[
					{
						id: 'e1',
						canonicalKey: 'sam',
						entityType: 'person',
						embedding: fakeEmbedding(),
						createdAt: new Date('2024-01-01')
					},
					{
						id: 'e2',
						canonicalKey: 'samuel',
						entityType: 'person',
						embedding: fakeEmbedding(1),
						createdAt: new Date('2024-01-02')
					}
				],
				[
					{
						id: 'e2',
						canonicalKey: 'samuel',
						entityType: 'person',
						createdAt: new Date('2024-01-02'),
						distance: 0.01
					}
				],
				[primaryRow],
				[{ thoughtId: 't1' }]
			],
			selectDistinct: [[{ thoughtId: 't1' }]],
			update: true,
			insertOnConflict: true,
			delete: true
		});
		getDbMock.mockReturnValue(db);

		await expect(consolidateCanonicalEntityAliasesForUser('u1')).resolves.toEqual({
			scanned: 2,
			candidates: 1,
			merged: 1
		});
		expect(db.update).toHaveBeenCalled();
		expect(db.insert).toHaveBeenCalled();
		expect(upsertEntityNodeMock).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'e1', userId: 'u1' })
		);
		expect(deleteEntityVertexFromGraphMock).toHaveBeenCalledWith({
			userId: 'u1',
			entityId: 'e2'
		});
		expect(db.delete).toHaveBeenCalled();
	});

	it('consolidateCanonicalEntityAliasesForUser keeps older nearest entity as primary when it is newer in scan order', async () => {
		const primaryRow = {
			id: 'e2',
			label: 'Samuel',
			entityType: 'person',
			canonicalKey: 'samuel'
		};
		const db = buildQueuedDb({
			selects: [
				[
					{
						id: 'e1',
						canonicalKey: 'sam',
						entityType: 'person',
						embedding: fakeEmbedding(),
						createdAt: new Date('2024-01-03')
					},
					{
						id: 'e2',
						canonicalKey: 'samuel',
						entityType: 'person',
						embedding: fakeEmbedding(1),
						createdAt: new Date('2024-01-01')
					}
				],
				[
					{
						id: 'e2',
						canonicalKey: 'samuel',
						entityType: 'person',
						createdAt: new Date('2024-01-01'),
						distance: 0.02
					}
				],
				[primaryRow],
				[]
			],
			selectDistinct: [[]],
			update: true,
			insertOnConflict: true,
			delete: true
		});
		getDbMock.mockReturnValue(db);

		await expect(consolidateCanonicalEntityAliasesForUser('u1')).resolves.toEqual({
			scanned: 2,
			candidates: 1,
			merged: 1
		});
		expect(upsertEntityNodeMock).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'e2', userId: 'u1' })
		);
		expect(deleteEntityVertexFromGraphMock).toHaveBeenCalledWith({
			userId: 'u1',
			entityId: 'e1'
		});
	});

	it('consolidateCanonicalEntityAliasesForUser skips rows already merged as secondary', async () => {
		const db = buildQueuedDb({
			selects: [
				[
					{
						id: 'e1',
						canonicalKey: 'sam',
						entityType: 'person',
						embedding: fakeEmbedding(),
						createdAt: new Date('2024-01-01')
					},
					{
						id: 'e2',
						canonicalKey: 'samuel',
						entityType: 'person',
						embedding: fakeEmbedding(1),
						createdAt: new Date('2024-01-02')
					},
					{
						id: 'e3',
						canonicalKey: 'samantha',
						entityType: 'person',
						embedding: fakeEmbedding(2),
						createdAt: new Date('2024-01-03')
					}
				],
				[
					{
						id: 'e2',
						canonicalKey: 'samuel',
						entityType: 'person',
						createdAt: new Date('2024-01-02'),
						distance: 0.01
					}
				],
				[
					{
						id: 'e1',
						label: 'Sam',
						entityType: 'person',
						canonicalKey: 'sam'
					}
				],
				[],
				[
					{
						id: 'e2',
						canonicalKey: 'samuel',
						entityType: 'person',
						createdAt: new Date('2024-01-02'),
						distance: 0.01
					}
				]
			],
			selectDistinct: [[], []],
			update: true,
			insertOnConflict: true,
			delete: true
		});
		getDbMock.mockReturnValue(db);

		await expect(consolidateCanonicalEntityAliasesForUser('u1')).resolves.toEqual({
			scanned: 3,
			candidates: 1,
			merged: 1
		});
	});
});
