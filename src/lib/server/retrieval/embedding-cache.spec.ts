import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearQueryEmbeddingCacheForTests,
	getCachedQueryEmbedding,
	setCachedQueryEmbedding
} from './embedding-cache';

describe('embedding-cache', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		clearQueryEmbeddingCacheForTests();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns undefined on cache miss', () => {
		expect(getCachedQueryEmbedding('u1', 'hello')).toBeUndefined();
	});

	it('returns cached embedding for same normalized query', () => {
		const embedding = [0.1, 0.2, 0.3];
		setCachedQueryEmbedding('u1', 'Hello  World', embedding);
		expect(getCachedQueryEmbedding('u1', 'hello world')).toEqual(embedding);
	});

	it('isolates cache entries per user', () => {
		setCachedQueryEmbedding('u1', 'q', [1]);
		setCachedQueryEmbedding('u2', 'q', [2]);
		expect(getCachedQueryEmbedding('u1', 'q')).toEqual([1]);
		expect(getCachedQueryEmbedding('u2', 'q')).toEqual([2]);
	});

	it('returns undefined for expired entries', () => {
		setCachedQueryEmbedding('u1', 'stale query', [0.9]);
		expect(getCachedQueryEmbedding('u1', 'stale query')).toEqual([0.9]);

		vi.advanceTimersByTime(5 * 60 * 1000 + 1);
		expect(getCachedQueryEmbedding('u1', 'stale query')).toBeUndefined();
	});

	it('evicts oldest entry when cache exceeds 256 entries', () => {
		setCachedQueryEmbedding('u1', 'first-query', [1]);
		for (let i = 0; i < 256; i++) {
			setCachedQueryEmbedding('u1', `query-${i}`, [i + 2]);
		}
		expect(getCachedQueryEmbedding('u1', 'first-query')).toEqual([1]);

		setCachedQueryEmbedding('u1', 'overflow-query', [999]);
		expect(getCachedQueryEmbedding('u1', 'first-query')).toBeUndefined();
		expect(getCachedQueryEmbedding('u1', 'query-0')).toEqual([2]);
		expect(getCachedQueryEmbedding('u1', 'overflow-query')).toEqual([999]);
	});
});
