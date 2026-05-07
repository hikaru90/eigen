import { describe, expect, it } from 'vitest';
import { extractFirstEmbedding } from './embedding';

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
});
