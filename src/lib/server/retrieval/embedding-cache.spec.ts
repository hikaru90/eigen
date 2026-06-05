import { beforeEach, describe, expect, it } from 'vitest';
import {
	clearQueryEmbeddingCacheForTests,
	getCachedQueryEmbedding,
	setCachedQueryEmbedding
} from './embedding-cache';

describe('embedding-cache', () => {
	beforeEach(() => {
		clearQueryEmbeddingCacheForTests();
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
});
