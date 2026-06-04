import { describe, expect, it } from 'vitest';
import {
	adjustChecksAfterRetrievalPrune,
	ingestBrokenEligibleForRetrievalPrune,
	ingestBrokenFixtureIdsFromAssertions,
	ndcgAt10ForRetrievalGrades,
	pruneRetrievalRelevantForIngestFailures,
	previewRetrievalPassAfterPrune
} from './prune-retrieval-relevant';
import type { CheckAssertionResult } from './qa-types';

describe('ingestBrokenEligibleForRetrievalPrune', () => {
	it('never includes the needle fixture', () => {
		expect(
			[...ingestBrokenEligibleForRetrievalPrune(['ec_a', 'ec_needle'], 'ec_needle')].sort()
		).toEqual(['ec_a']);
	});
});

describe('pruneRetrievalRelevantForIngestFailures', () => {
	it('removes only broken fixtures from retrieval grades', () => {
		const relevant = [
			{ id: 'ec_a', grade: 3 as const },
			{ id: 'ec_b', grade: 2 as const },
			{ id: 'ec_c', grade: 1 as const }
		];
		const { retrievalRelevant, removed } = pruneRetrievalRelevantForIngestFailures({
			retrievalRelevant: relevant,
			ingestBrokenFixtureIds: new Set(['ec_b'])
		});
		expect(removed).toEqual(['ec_b']);
		expect(retrievalRelevant).toEqual([
			{ id: 'ec_a', grade: 3 },
			{ id: 'ec_c', grade: 1 }
		]);
	});

	it('retains needle when ingest failed on needle', () => {
		const { retrievalRelevant, removed } = pruneRetrievalRelevantForIngestFailures({
			retrievalRelevant: [{ id: 'ec_needle', grade: 3 }],
			ingestBrokenFixtureIds: new Set(['ec_needle']),
			needleFixtureId: 'ec_needle'
		});
		expect(removed).toEqual([]);
		expect(retrievalRelevant).toEqual([{ id: 'ec_needle', grade: 3 }]);
	});
});

describe('ingestBrokenFixtureIdsFromAssertions', () => {
	it('collects fixture ids from failed ingest assertions only', () => {
		const assertions: CheckAssertionResult[] = [
			{ id: 'entities_ec_x', label: 'x', passed: false, evidence: '', fixtureId: 'ec_x' },
			{ id: 'retrieval_ndcg', label: 'ndcg', passed: false, evidence: '' },
			{ id: 'embedding_ec_y', label: 'y', passed: false, evidence: '', fixtureId: 'ec_y' },
			{ id: 'enriched_ec_z', label: 'z', passed: false, evidence: '', fixtureId: 'ec_z' },
			{ id: 'entities_ec_z', label: 'z', passed: true, evidence: '', fixtureId: 'ec_z' }
		];
		expect([...ingestBrokenFixtureIdsFromAssertions(assertions)].sort()).toEqual([
			'ec_x',
			'ec_y',
			'ec_z'
		]);
	});
});

describe('adjustChecksAfterRetrievalPrune', () => {
	it('clears needle when needle fixture is pruned', () => {
		const checks = {
			retrieval: { minNdcgAt10: 0.5, needleFixtureId: 'ec_needle', needleTopK: 5 }
		};
		const next = adjustChecksAfterRetrievalPrune(checks, new Set(['ec_needle']));
		expect(next.retrieval?.needleFixtureId).toBeUndefined();
		expect(next.retrieval?.minNdcgAt10).toBe(0.5);
	});
});

describe('ndcg recompute preview', () => {
	const fixtureToUuid = new Map([
		['ec_a', 'uuid-a'],
		['ec_b', 'uuid-b']
	]);

	it('improves NDCG when a broken relevant item is removed from grades', () => {
		const topRanked = ['ec_a'];
		const before = ndcgAt10ForRetrievalGrades({
			topRankedFixtureIds: topRanked,
			retrievalRelevant: [
				{ id: 'ec_a', grade: 3 },
				{ id: 'ec_b', grade: 3 }
			],
			fixtureToUuid
		});
		const after = ndcgAt10ForRetrievalGrades({
			topRankedFixtureIds: topRanked,
			retrievalRelevant: [{ id: 'ec_a', grade: 3 }],
			fixtureToUuid
		});
		expect(before).not.toBeNull();
		expect(after).not.toBeNull();
		expect(after!).toBeGreaterThan(before!);
		const pass = previewRetrievalPassAfterPrune({
			topRankedFixtureIds: topRanked,
			retrievalRelevant: [{ id: 'ec_a', grade: 3 }],
			fixtureToUuid,
			minNdcgAt10: 0.99
		});
		expect(pass.wouldPass).toBe(true);
	});
});
