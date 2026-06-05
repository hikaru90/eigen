import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTEXT_WEIGHTS } from '$lib/server/retrieval';
import { searchThoughts } from './service';

const {
	createThoughtEmbeddingMock,
	getDbMock,
	lexicalSearchMock,
	expandNeighborsByIdsMock,
	expandThoughtIdsFromEntitySeedsMock,
	matchCanonicalEntitiesByEmbeddingMock
} = vi.hoisted(() => ({
	createThoughtEmbeddingMock: vi.fn(),
	getDbMock: vi.fn(),
	lexicalSearchMock: vi.fn(),
	expandNeighborsByIdsMock: vi.fn(),
	expandThoughtIdsFromEntitySeedsMock: vi.fn(),
	matchCanonicalEntitiesByEmbeddingMock: vi.fn()
}));

vi.mock('$lib/server/llm/embedding', () => ({
	createThoughtEmbedding: createThoughtEmbeddingMock
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/retrieval/lexical', () => ({
	lexicalSearch: lexicalSearchMock
}));

vi.mock('$lib/server/graph/age', () => ({
	expandNeighborsByIds: expandNeighborsByIdsMock,
	expandThoughtIdsFromEntitySeeds: expandThoughtIdsFromEntitySeedsMock
}));

vi.mock('$lib/server/memory/entity-resolution', () => ({
	matchCanonicalEntitiesByEmbedding: matchCanonicalEntitiesByEmbeddingMock
}));

vi.mock('$lib/server/retrieval/temporal', () => ({
	isTemporalQuery: vi.fn(() => false),
	filterTemporalEvents: vi.fn(async () => []),
	traverseTemporalContext: vi.fn(async () => [])
}));

function makeDb(selectResults: unknown[][]) {
	let index = 0;
	const limits: number[] = [];
	const db = {
		__resetSelectIndex: () => {
			index = 0;
		},
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => {
					const current = selectResults[index] ?? [];
					index += 1;
					if (index === 1) {
						return {
							orderBy: vi.fn(() => ({
								limit: vi.fn(async (n: number) => {
									limits.push(n);
									return current as unknown[];
								})
							}))
						};
					}
					return Promise.resolve(current as unknown[]);
				})
			}))
		})),
		limits
	};
	return db;
}

describe('searchThoughts', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		createThoughtEmbeddingMock.mockResolvedValue([0.1, 0.2]);
		lexicalSearchMock.mockResolvedValue([]);
		expandNeighborsByIdsMock.mockResolvedValue([]);
		matchCanonicalEntitiesByEmbeddingMock.mockResolvedValue([]);
		expandThoughtIdsFromEntitySeedsMock.mockResolvedValue([]);
	});

	it('still expands graph when semantic channels are empty', async () => {
		const connectedRows = [{ id: 'g1', normalizedText: 'Graph only', category: 'thought', metadata: {} }];
		const db = makeDb([[], connectedRows]);
		getDbMock.mockReturnValue(db);
		matchCanonicalEntitiesByEmbeddingMock.mockResolvedValue([
			{ id: 'ent-1', label: 'Sam', distance: 0.1 }
		]);
		expandThoughtIdsFromEntitySeedsMock.mockResolvedValue([
			{ id: 'g1', hits: 2, provenance: 'entity:Sam' }
		]);

		const result = await searchThoughts({ userId: 'u1', query: 'x', topK: 5 });
		expect(result.map((r) => r.id)).toContain('g1');
		expect(expandThoughtIdsFromEntitySeedsMock).toHaveBeenCalled();
	});

	it('merges semantic and graph results and scores deterministically', async () => {
		const vectorRows = [
			{
				id: 'a',
				normalizedText: 'A',
				category: 'thought',
				metadata: {},
				distance: 0.1
			},
			{
				id: 'b',
				normalizedText: 'B',
				category: 'thought',
				metadata: {},
				distance: 0.4
			}
		];
		const lexicalRows = [{ id: 'b', normalizedText: 'B', category: 'thought', metadata: {}, lexicalScore: 0.5 }];
		const connectedRows = [{ id: 'c', normalizedText: 'C', category: 'idea', metadata: { from: 'graph' } }];
		const db = makeDb([vectorRows, connectedRows]);
		getDbMock.mockReturnValue(db);
		lexicalSearchMock.mockResolvedValue(lexicalRows);
		expandNeighborsByIdsMock.mockResolvedValue([{ id: 'c', hits: 1, provenance: 'via_related:refines' }]);

		const result = await searchThoughts({ userId: 'u1', query: 'query', topK: 2 });
		expect(result).toHaveLength(2);
		expect(result[0].score).toBeGreaterThanOrEqual(result[1].score);
		expect(result.map((r) => r.id)).toEqual(expect.arrayContaining(['a', 'b']));
	});

	it('clamps topK to 100 max and vector fetch to 200', async () => {
		const db = makeDb([[{ id: 'a', normalizedText: 'A', category: 'thought', metadata: {}, distance: 0.2 }], []]);
		getDbMock.mockReturnValue(db);
		await searchThoughts({ userId: 'u1', query: 'query', topK: 500 });
		expect(db.limits[0]).toBe(200);
	});

	it('supports lexical-only candidates and custom weights', async () => {
		const db = makeDb([[], []]);
		getDbMock.mockReturnValue(db);
		lexicalSearchMock.mockResolvedValue([
			{ id: 'l1', normalizedText: 'lexical result', category: 'reference', metadata: {}, lexicalScore: 0.9 }
		]);
		expandNeighborsByIdsMock.mockResolvedValue([]);

		const result = await searchThoughts({
			userId: 'u1',
			query: 'query',
			topK: 5,
			weights: { vector: 0.5, graph: 0.5 }
		});
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('l1');
	});

	it('uses CONTEXT_WEIGHTS.default when weights are omitted', async () => {
		const vectorRows = [
			{
				id: 'a',
				normalizedText: 'A',
				category: 'thought',
				metadata: {},
				distance: 0.1
			},
			{
				id: 'b',
				normalizedText: 'B',
				category: 'thought',
				metadata: {},
				distance: 0.4
			}
		];
		const lexicalRows = [{ id: 'b', normalizedText: 'B', category: 'thought', metadata: {}, lexicalScore: 0.5 }];
		const connectedRows = [{ id: 'c', normalizedText: 'C', category: 'idea', metadata: { from: 'graph' } }];
		const db = makeDb([vectorRows, connectedRows]);
		getDbMock.mockReturnValue(db);
		lexicalSearchMock.mockResolvedValue(lexicalRows);
		expandNeighborsByIdsMock.mockResolvedValue([{ id: 'c', hits: 1, provenance: 'via_related:refines' }]);

		const explicit = await searchThoughts({
			userId: 'u1',
			query: 'query',
			topK: 2,
			weights: CONTEXT_WEIGHTS.default
		});
		db.__resetSelectIndex();
		const implicit = await searchThoughts({ userId: 'u1', query: 'query', topK: 2 });
		expect(implicit.map((r) => ({ id: r.id, score: r.score, vectorScore: r.vectorScore, graphScore: r.graphScore }))).toEqual(
			explicit.map((r) => ({ id: r.id, score: r.score, vectorScore: r.vectorScore, graphScore: r.graphScore }))
		);
	});

	it('adds connected rows not already scored', async () => {
		const vectorRows = [{ id: 'a', normalizedText: 'A', category: 'thought', metadata: {}, distance: 0.2 }];
		const connectedRows = [{ id: 'c', normalizedText: 'C', category: 'idea', metadata: {} }];
		const db = makeDb([vectorRows, connectedRows]);
		getDbMock.mockReturnValue(db);
		lexicalSearchMock.mockResolvedValue([]);
		expandNeighborsByIdsMock.mockResolvedValue([{ id: 'c', hits: 2, provenance: 'via_related:mentions' }]);

		const result = await searchThoughts({ userId: 'u1', query: 'query', topK: 5 });
		expect(result.map((r) => r.id)).toEqual(expect.arrayContaining(['a', 'c']));
		const connected = result.find((r) => r.id === 'c');
		expect(connected?.metadata.graphProvenance).toBe('via_related:mentions');
	});

	it('covers duplicate and null-metadata branches', async () => {
		const vectorRows = [{ id: 'a', normalizedText: 'A', category: 'thought', metadata: null, distance: 0.1 }];
		const connectedRows = [{ id: 'a', normalizedText: 'A2', category: 'thought', metadata: null }];
		const db = makeDb([vectorRows, connectedRows]);
		getDbMock.mockReturnValue(db);
		lexicalSearchMock.mockResolvedValue([{ id: 'a', normalizedText: 'A', category: 'thought', metadata: null, lexicalScore: 0.4 }]);
		expandNeighborsByIdsMock.mockResolvedValue([{ id: 'a', hits: 1 }]);

		const result = await searchThoughts({ userId: 'u1', query: 'query', topK: 5 });
		expect(result[0].id).toBe('a');
	});

	it('expands entity-anchored hits and attaches graph provenance to a connected thought', async () => {
		const vectorRows = [
			{ id: 'a', normalizedText: 'A', category: 'thought', metadata: {}, distance: 0.1 }
		];
		const connectedRows = [
			{ id: 'b', normalizedText: 'B', category: 'thought', metadata: {} }
		];
		const db = makeDb([vectorRows, connectedRows]);
		getDbMock.mockReturnValue(db);
		expandNeighborsByIdsMock.mockResolvedValue([]);
		matchCanonicalEntitiesByEmbeddingMock.mockResolvedValue([
			{ id: 'ent-1', label: 'Sam', distance: 0.1 },
			{ id: 'ent-2', label: 'Drop', distance: 0.99 }
		]);
		expandThoughtIdsFromEntitySeedsMock.mockResolvedValue([
			{ id: 'b', hits: 3, provenance: 'entity:Sam' }
		]);

		const result = await searchThoughts({ userId: 'u1', query: 'q', topK: 5 });
		const connected = result.find((r) => r.id === 'b');
		expect(connected?.metadata.graphProvenance).toBe('entity:Sam');
		expect(expandThoughtIdsFromEntitySeedsMock).toHaveBeenCalledWith(
			expect.objectContaining({ entityIds: ['ent-1'] })
		);
	});

	it('merges entity hits onto a semantic hit and back-fills its graph provenance', async () => {
		const vectorRows = [
			{ id: 'a', normalizedText: 'A', category: 'thought', metadata: {}, distance: 0.1 }
		];
		const db = makeDb([vectorRows, []]);
		getDbMock.mockReturnValue(db);
		expandNeighborsByIdsMock.mockResolvedValue([{ id: 'a', hits: 1 }]);
		matchCanonicalEntitiesByEmbeddingMock.mockResolvedValue([
			{ id: 'ent-1', label: 'Sam', distance: 0.05 }
		]);
		expandThoughtIdsFromEntitySeedsMock.mockResolvedValue([
			{ id: 'a', hits: 2, provenance: 'entity:Sam' }
		]);

		const result = await searchThoughts({ userId: 'u1', query: 'q', topK: 5 });
		const semantic = result.find((r) => r.id === 'a');
		expect(semantic?.metadata.graphProvenance).toBe('entity:Sam');
	});

	it('accumulates hits when the same neighbor id appears multiple times', async () => {
		const vectorRows = [
			{ id: 'a', normalizedText: 'A', category: 'thought', metadata: {}, distance: 0.1 }
		];
		const connectedRows = [{ id: 'b', normalizedText: 'B', category: 'thought', metadata: {} }];
		const db = makeDb([vectorRows, connectedRows]);
		getDbMock.mockReturnValue(db);
		expandNeighborsByIdsMock.mockResolvedValue([
			{ id: 'b', hits: 1 },
			{ id: 'b', hits: 2 }
		]);

		const result = await searchThoughts({ userId: 'u1', query: 'q', topK: 5 });
		expect(result.map((r) => r.id)).toEqual(expect.arrayContaining(['a', 'b']));
	});

	it('ranks distinct neighbors by descending hit count', async () => {
		const vectorRows = [
			{ id: 'a', normalizedText: 'A', category: 'thought', metadata: {}, distance: 0.1 }
		];
		const connectedRows = [
			{ id: 'b', normalizedText: 'B', category: 'thought', metadata: {} },
			{ id: 'c', normalizedText: 'C', category: 'thought', metadata: {} }
		];
		const db = makeDb([vectorRows, connectedRows]);
		getDbMock.mockReturnValue(db);
		expandNeighborsByIdsMock.mockResolvedValue([
			{ id: 'b', hits: 1 },
			{ id: 'c', hits: 5 }
		]);

		const result = await searchThoughts({
			userId: 'u1',
			query: 'q',
			topK: 5,
			weights: { vector: 0, graph: 1 }
		});
		const bIdx = result.findIndex((r) => r.id === 'b');
		const cIdx = result.findIndex((r) => r.id === 'c');
		expect(cIdx).toBeLessThan(bIdx);
	});

	it('fast mode skips graph and entity expansion', async () => {
		const vectorRows = [
			{ id: 'a', normalizedText: 'A', category: 'thought', metadata: {}, distance: 0.1 }
		];
		const db = makeDb([vectorRows]);
		getDbMock.mockReturnValue(db);
		lexicalSearchMock.mockResolvedValue([]);

		await searchThoughts({ userId: 'u1', query: 'x', topK: 5, mode: 'fast' });
		expect(expandNeighborsByIdsMock).not.toHaveBeenCalled();
		expect(matchCanonicalEntitiesByEmbeddingMock).not.toHaveBeenCalled();
		expect(db.limits[0]).toBe(10);
	});

	it('skips entity expansion when all entity distances exceed the cutoff', async () => {
		const vectorRows = [
			{ id: 'a', normalizedText: 'A', category: 'thought', metadata: {}, distance: 0.1 }
		];
		const db = makeDb([vectorRows, []]);
		getDbMock.mockReturnValue(db);
		matchCanonicalEntitiesByEmbeddingMock.mockResolvedValue([
			{ id: 'far', label: 'Far', distance: 0.95 }
		]);

		await searchThoughts({ userId: 'u1', query: 'q', topK: 5 });
		expect(expandThoughtIdsFromEntitySeedsMock).not.toHaveBeenCalled();
	});
});
