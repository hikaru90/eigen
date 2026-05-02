import { describe, expect, it } from 'vitest';
import {
	combinedScore,
	CONTEXT_WEIGHTS,
	rankCandidates,
	selectRetrievalModeFromQuery
} from './retrieval';

describe('CONTEXT_WEIGHTS', () => {
	it('matches AC-011 and AC-012', () => {
		expect(CONTEXT_WEIGHTS.default).toEqual({ vector: 0.7, graph: 0.3 });
		expect(CONTEXT_WEIGHTS.relation_centric).toEqual({ vector: 0.4, graph: 0.6 });
	});
});

describe('combinedScore', () => {
	it('scores deterministically for default mode', () => {
		const c = { id: 'a', vectorScore: 1, graphScore: 0 };
		expect(combinedScore(c, 'default')).toBeCloseTo(0.7);
	});

	it('scores deterministically for relation-centric mode', () => {
		const c = { id: 'a', vectorScore: 1, graphScore: 0 };
		expect(combinedScore(c, 'relation_centric')).toBeCloseTo(0.4);
	});
});

describe('rankCandidates', () => {
	it('orders by combined score descending', () => {
		const ranked = rankCandidates(
			[
				{ id: 'low', vectorScore: 0.5, graphScore: 0.5 },
				{ id: 'high', vectorScore: 1, graphScore: 1 }
			],
			'default'
		);
		expect(ranked[0].id).toBe('high');
	});
});

describe('selectRetrievalModeFromQuery', () => {
	it('uses relation-centric for relationship-style queries', () => {
		expect(selectRetrievalModeFromQuery('What is the relationship between A and B?')).toBe(
			'relation_centric'
		);
	});

	it('uses default otherwise', () => {
		expect(selectRetrievalModeFromQuery('Where did I store my grocery list?')).toBe('default');
	});
});
