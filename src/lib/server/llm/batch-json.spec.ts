import { describe, expect, it } from 'vitest';
import { parseBatchJsonArray } from './batch-json';

describe('parseBatchJsonArray', () => {
	it('maps each id to parsed output', () => {
		const content = JSON.stringify([
			{ id: 'a', score: 1 },
			{ id: 'b', score: 2 }
		]);
		const out = parseBatchJsonArray(content, ['a', 'b'], 'test', (id, value) => ({
			id,
			score: (value as { score: number }).score
		}));
		expect(out.get('a')?.score).toBe(1);
		expect(out.get('b')?.score).toBe(2);
	});

	it('throws when an expected id is missing', () => {
		const content = JSON.stringify([{ id: 'a', score: 1 }]);
		expect(() =>
			parseBatchJsonArray(content, ['a', 'b'], 'test', (id, value) => ({
				id,
				score: (value as { score: number }).score
			}))
		).toThrow(/missing ids: b/);
	});

	it('throws on duplicate ids', () => {
		const content = JSON.stringify([
			{ id: 'a', score: 1 },
			{ id: 'a', score: 2 }
		]);
		expect(() =>
			parseBatchJsonArray(content, ['a'], 'test', (id, value) => ({
				id,
				score: (value as { score: number }).score
			}))
		).toThrow(/duplicate id/);
	});
});
