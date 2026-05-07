import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchThoughts } from './service';

const { createThoughtEmbeddingMock, getDbMock } = vi.hoisted(() => ({
	createThoughtEmbeddingMock: vi.fn(),
	getDbMock: vi.fn()
}));

vi.mock('$lib/server/llm/embedding', () => ({
	createThoughtEmbedding: createThoughtEmbeddingMock
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

function makeDb(selectResults: unknown[]) {
	let index = 0;
	const limits: number[] = [];
	const db = {
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => {
					const current = index++;
					if (current === 0) {
						return {
							orderBy: vi.fn(() => ({
								limit: vi.fn(async (n: number) => {
									limits.push(n);
									return selectResults[current] as unknown[];
								})
							}))
						};
					}
					return Promise.resolve(selectResults[current] as unknown[]);
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
	});

	it('returns empty array when no vector candidates are found', async () => {
		const db = makeDb([[]]);
		getDbMock.mockReturnValue(db);
		const result = await searchThoughts({ userId: 'u1', query: 'x' });
		expect(result).toEqual([]);
	});

	it('merges vector and connected graph results and scores deterministically', async () => {
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
		const relationRows = [{ sourceThoughtId: 'a', targetThoughtId: 'c' }];
		const connectedRows = [
			{ id: 'c', normalizedText: 'C', category: 'idea', metadata: { from: 'graph' } }
		];
		const db = makeDb([vectorRows, relationRows, connectedRows]);
		getDbMock.mockReturnValue(db);

		const result = await searchThoughts({ userId: 'u1', query: 'query', topK: 2 });
		expect(result).toHaveLength(2);
		expect(result[0].score).toBeGreaterThanOrEqual(result[1].score);
		expect(result.map((r) => r.id)).toEqual(expect.arrayContaining(['a']));
	});

	it('clamps topK to 100 max and vector fetch to 200', async () => {
		const db = makeDb([[{ id: 'a', normalizedText: 'A', category: 'thought', metadata: {}, distance: 0.2 }], [], []]);
		getDbMock.mockReturnValue(db);
		await searchThoughts({ userId: 'u1', query: 'query', topK: 500 });
		expect(db.limits[0]).toBe(200);
	});
});
