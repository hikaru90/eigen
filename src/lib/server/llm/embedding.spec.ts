import { describe, expect, it, vi } from 'vitest';
import { createThoughtEmbedding, extractFirstEmbedding } from './embedding';

const { llmCreateEmbeddingsMock } = vi.hoisted(() => ({
	llmCreateEmbeddingsMock: vi.fn()
}));

vi.mock('./llm-client', () => ({
	llmCreateEmbeddings: llmCreateEmbeddingsMock
}));

describe('extractFirstEmbedding', () => {
	it('returns first embedding when response shape is valid', () => {
		const embedding = Array.from({ length: 1536 }, (_, i) => i / 1000);
		const result = extractFirstEmbedding({
			data: [{ embedding }]
		});
		expect(result).toHaveLength(1536);
		expect(result[0]).toBe(0);
		expect(result[10]).toBeCloseTo(0.01);
	});

	it('throws when data is missing', () => {
		expect(() => extractFirstEmbedding({})).toThrow(/empty data/);
	});

	it('throws when dimensions do not match expected size', () => {
		expect(() => extractFirstEmbedding({ data: [{ embedding: [1, 2, 3] }] })).toThrow(/dimensions/);
	});

	it('throws when top-level response is not object', () => {
		expect(() => extractFirstEmbedding(null)).toThrow(/not an object/);
	});

	it('throws when first item is invalid', () => {
		expect(() => extractFirstEmbedding({ data: [null] })).toThrow(/first item is invalid/);
	});

	it('throws when embedding contains non-numeric values', () => {
		expect(() =>
			extractFirstEmbedding({
				data: [{ embedding: Array.from({ length: 1536 }, (_, i) => (i === 2 ? 'x' : i)) }]
			})
		).toThrow(/non-numeric/);
	});
});

describe('createThoughtEmbedding', () => {
	it('calls embedding client and parses first embedding', async () => {
		llmCreateEmbeddingsMock.mockResolvedValue({
			data: [{ embedding: Array.from({ length: 1536 }, () => 0.1) }]
		});
		const out = await createThoughtEmbedding('u1', 'hello');
		expect(out).toHaveLength(1536);
		expect(llmCreateEmbeddingsMock).toHaveBeenCalledWith({ userId: 'u1', input: 'hello' });
	});
});
