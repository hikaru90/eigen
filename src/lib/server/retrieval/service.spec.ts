import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchThoughts } from './service';

const { createThoughtEmbeddingMock, getDbMock, lexicalSearchMock, expandNeighborsByIdsMock } = vi.hoisted(() => ({
	createThoughtEmbeddingMock: vi.fn(),
	getDbMock: vi.fn(),
	lexicalSearchMock: vi.fn(),
	expandNeighborsByIdsMock: vi.fn()
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

vi.mock('$lib/server/graph/falkor', () => ({
	expandNeighborsByIds: expandNeighborsByIdsMock
}));

function makeDb(selectResults: unknown[][]) {
	let index = 0;
	const limits: number[] = [];
	const db = {
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
	});

	it('returns empty array when no semantic candidates are found', async () => {
		const db = makeDb([[]]);
		getDbMock.mockReturnValue(db);
		const result = await searchThoughts({ userId: 'u1', query: 'x' });
		expect(result).toEqual([]);
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
		expandNeighborsByIdsMock.mockResolvedValue([{ id: 'c', hits: 1 }]);

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

	it('adds connected rows not already scored', async () => {
		const vectorRows = [{ id: 'a', normalizedText: 'A', category: 'thought', metadata: {}, distance: 0.2 }];
		const connectedRows = [{ id: 'c', normalizedText: 'C', category: 'idea', metadata: {} }];
		const db = makeDb([vectorRows, connectedRows]);
		getDbMock.mockReturnValue(db);
		lexicalSearchMock.mockResolvedValue([]);
		expandNeighborsByIdsMock.mockResolvedValue([{ id: 'c', hits: 2 }]);

		const result = await searchThoughts({ userId: 'u1', query: 'query', topK: 5 });
		expect(result.map((r) => r.id)).toEqual(expect.arrayContaining(['a', 'c']));
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
});
