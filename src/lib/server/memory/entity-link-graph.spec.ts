import { describe, expect, it } from 'vitest';
import {
	buildEntityAdjacency,
	neighborEntityIds,
	pickGraphMergeWinner,
	scoreGraphLinkCandidate
} from './entity-link-graph';

describe('entity-link-graph', () => {
	it('scores neighbor + type match above isolated candidate', () => {
		const adj = buildEntityAdjacency([{ sourceId: 'e-berlin', targetId: 'e-samuel', weight: 1 }]);
		const neighbors = neighborEntityIds(adj, ['e-berlin']);
		const samuel = scoreGraphLinkCandidate({
			candidateId: 'e-samuel',
			candidateEntityType: 'person',
			candidateCanonicalKey: 'samuel',
			mentionEntityType: 'person',
			mentionKey: 'sam',
			coMentionEntityIds: new Set(['e-berlin']),
			neighborEntityIds: neighbors
		});
		const other = scoreGraphLinkCandidate({
			candidateId: 'e-other',
			candidateEntityType: 'person',
			candidateCanonicalKey: 'other person',
			mentionEntityType: 'person',
			mentionKey: 'sam',
			coMentionEntityIds: new Set(['e-berlin']),
			neighborEntityIds: neighbors
		});
		expect(samuel).toBeGreaterThan(other);
	});

	it('returns ambiguous when top two graph scores are too close', () => {
		const pick = pickGraphMergeWinner([
			{
				id: 'a',
				canonicalKey: 'a',
				label: 'A',
				entityType: 'person',
				graphScore: 6
			},
			{
				id: 'b',
				canonicalKey: 'b',
				label: 'B',
				entityType: 'person',
				graphScore: 5
			}
		]);
		expect(pick).toEqual({ kind: 'ambiguous', topScore: 6, runnerUpScore: 5 });
	});

	it('returns winner when margin is sufficient', () => {
		const pick = pickGraphMergeWinner([
			{
				id: 'a',
				canonicalKey: 'a',
				label: 'A',
				entityType: 'person',
				graphScore: 10
			},
			{
				id: 'b',
				canonicalKey: 'b',
				label: 'B',
				entityType: 'person',
				graphScore: 5
			}
		]);
		expect(pick.kind).toBe('winner');
		if (pick.kind === 'winner') {
			expect(pick.candidate.id).toBe('a');
		}
	});
});
