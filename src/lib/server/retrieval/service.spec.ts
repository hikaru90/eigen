import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchThoughts } from './service';

const { retrieveEvidenceMock } = vi.hoisted(() => ({
	retrieveEvidenceMock: vi.fn()
}));

vi.mock('$lib/server/retrieval/retrieve-evidence', () => ({
	retrieveEvidence: retrieveEvidenceMock
}));

describe('searchThoughts', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		retrieveEvidenceMock.mockResolvedValue([
			{
				id: 't1',
				normalizedText: 'hello',
				category: 'thought',
				memoryType: null,
				score: 0.9,
				vectorScore: 0.8,
				graphScore: 0.1,
				metadata: {},
				createdAt: new Date()
			}
		]);
	});

	it('delegates to retrieveEvidence with query and topK', async () => {
		const result = await searchThoughts({ userId: 'u1', query: 'hello world', topK: 5 });
		expect(retrieveEvidenceMock).toHaveBeenCalledWith({
			userId: 'u1',
			query: 'hello world',
			topK: 5,
			queryEmbedding: undefined
		});
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('t1');
	});

	it('forwards queryEmbedding when provided', async () => {
		const embedding = [0.1, 0.2];
		await searchThoughts({
			userId: 'u1',
			query: 'q',
			queryEmbedding: embedding
		});
		expect(retrieveEvidenceMock).toHaveBeenCalledWith(
			expect.objectContaining({ queryEmbedding: embedding })
		);
	});

	it('ignores legacy mode and weights (unified path)', async () => {
		await searchThoughts({
			userId: 'u1',
			query: 'q',
			mode: 'fast',
			weights: { vector: 0.4, graph: 0.6 }
		});
		expect(retrieveEvidenceMock).toHaveBeenCalledWith(
			expect.objectContaining({ userId: 'u1', query: 'q' })
		);
	});
});
