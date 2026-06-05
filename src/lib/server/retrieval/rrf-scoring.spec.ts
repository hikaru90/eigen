import { describe, expect, it } from 'vitest';
import { CONTEXT_WEIGHTS } from '$lib/server/retrieval';
import {
	maxFusedRrfScore,
	normalizeFusedRrfScore,
	normalizeRetrievalScore,
	MAX_RETRIEVAL_MERGE_SCORE
} from './rrf-scoring';

describe('normalizeRetrievalScore', () => {
	it('maps weighted-merge scores to [0, 1]', () => {
		expect(normalizeRetrievalScore(MAX_RETRIEVAL_MERGE_SCORE)).toBe(1);
		expect(normalizeRetrievalScore(MAX_RETRIEVAL_MERGE_SCORE / 2)).toBeCloseTo(0.5, 5);
	});
});

describe('rrf-scoring (legacy RRF helpers)', () => {
	it('normalizes top fused score to 1 for default weights', () => {
		const max = maxFusedRrfScore(CONTEXT_WEIGHTS.default);
		expect(normalizeFusedRrfScore(max, CONTEXT_WEIGHTS.default)).toBeCloseTo(1, 5);
	});

	it('maps sub-threshold raw scores below 1', () => {
		const half = maxFusedRrfScore(CONTEXT_WEIGHTS.default) / 2;
		expect(normalizeFusedRrfScore(half, CONTEXT_WEIGHTS.default)).toBeCloseTo(0.5, 5);
	});

	it('returns 0 when max fused score is not positive', () => {
		const zeroWeights = { vector: 0, graph: 0 };
		expect(maxFusedRrfScore(zeroWeights)).toBe(0);
		expect(normalizeFusedRrfScore(0.5, zeroWeights)).toBe(0);
	});
});
