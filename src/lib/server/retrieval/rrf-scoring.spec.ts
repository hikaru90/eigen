import { describe, expect, it } from 'vitest';
import { CONTEXT_WEIGHTS } from '$lib/server/retrieval';
import { maxFusedRrfScore, normalizeFusedRrfScore } from './rrf-scoring';

describe('rrf-scoring', () => {
	it('normalizes top fused score to 1 for default weights', () => {
		const max = maxFusedRrfScore(CONTEXT_WEIGHTS.default);
		expect(normalizeFusedRrfScore(max, CONTEXT_WEIGHTS.default)).toBeCloseTo(1, 5);
	});

	it('maps sub-threshold raw scores below 1', () => {
		const half = maxFusedRrfScore(CONTEXT_WEIGHTS.default) / 2;
		expect(normalizeFusedRrfScore(half, CONTEXT_WEIGHTS.default)).toBeCloseTo(0.5, 5);
	});
});
