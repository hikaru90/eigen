import { describe, expect, it } from 'vitest';
import {
	buildEntityAdjacency,
	hasLexicalMergeEvidence,
	neighborEntityIds,
	pickGraphMergeWinner,
	scoreGraphLinkCandidate
} from './entity-link-graph';

describe('entity-link-graph', () => {
	it('hasLexicalMergeEvidence requires exact lexical key match only', () => {
		expect(hasLexicalMergeEvidence('sam', 'sam')).toBe(true);
		expect(hasLexicalMergeEvidence('sam', 'samuel')).toBe(false);
		expect(hasLexicalMergeEvidence('alex', 'annie')).toBe(false);
	});

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

	it('returns none when top score is below the merge threshold', () => {
		expect(
			pickGraphMergeWinner([
				{
					id: 'a',
					canonicalKey: 'a',
					label: 'A',
					entityType: 'person',
					graphScore: 4
				}
			])
		).toEqual({ kind: 'none' });
	});

	it('returns winner for a single candidate above the threshold', () => {
		const pick = pickGraphMergeWinner([
			{
				id: 'solo',
				canonicalKey: 'solo',
				label: 'Solo',
				entityType: 'person',
				graphScore: 7
			}
		]);
		expect(pick).toEqual({
			kind: 'winner',
			candidate: expect.objectContaining({ id: 'solo' })
		});
	});

	it('buildEntityAdjacency ignores self-edges and links both directions', () => {
		const adj = buildEntityAdjacency([
			{ sourceId: 'e-a', targetId: 'e-a' },
			{ sourceId: 'e-a', targetId: 'e-b' }
		]);
		expect(adj.get('e-a')?.has('e-b')).toBe(true);
		expect(adj.get('e-b')?.has('e-a')).toBe(true);
		expect(adj.get('e-a')?.has('e-a')).toBe(false);
	});

	it('neighborEntityIds returns empty set for unknown seeds', () => {
		const adj = buildEntityAdjacency([{ sourceId: 'e-a', targetId: 'e-b' }]);
		expect(neighborEntityIds(adj, ['missing'])).toEqual(new Set());
	});

	it('adds co-mention bonus when candidate shares neighbors with another mention', () => {
		const adj = buildEntityAdjacency([
			{ sourceId: 'e-berlin', targetId: 'e-samuel' },
			{ sourceId: 'e-berlin', targetId: 'e-marcus' }
		]);
		const neighbors = neighborEntityIds(adj, ['e-berlin']);
		const withCoMention = scoreGraphLinkCandidate({
			candidateId: 'e-samuel',
			candidateEntityType: 'person',
			candidateCanonicalKey: 'samuel',
			mentionEntityType: 'person',
			mentionKey: 'sam',
			coMentionEntityIds: new Set(['e-berlin', 'e-marcus']),
			neighborEntityIds: neighbors
		});
		const withoutCoMention = scoreGraphLinkCandidate({
			candidateId: 'e-samuel',
			candidateEntityType: 'person',
			candidateCanonicalKey: 'samuel',
			mentionEntityType: 'person',
			mentionKey: 'sam',
			coMentionEntityIds: new Set(['e-berlin']),
			neighborEntityIds: neighbors
		});
		expect(withCoMention).toBeGreaterThan(withoutCoMention);
		expect(withCoMention - withoutCoMention).toBe(3);
	});

	it('scores exact lexical key match only (no substring bonus)', () => {
		const score = scoreGraphLinkCandidate({
			candidateId: 'e-sam',
			candidateEntityType: 'person',
			candidateCanonicalKey: 'sam',
			mentionEntityType: 'person',
			mentionKey: 'sam',
			coMentionEntityIds: new Set(),
			neighborEntityIds: new Set()
		});
		expect(score).toBe(4);
	});

	it('skips co-mention self-match when candidate is also in co-mention set', () => {
		const adj = buildEntityAdjacency([{ sourceId: 'e-berlin', targetId: 'e-samuel' }]);
		const neighbors = neighborEntityIds(adj, ['e-berlin']);
		const score = scoreGraphLinkCandidate({
			candidateId: 'e-samuel',
			candidateEntityType: 'person',
			candidateCanonicalKey: 'samuel',
			mentionEntityType: 'person',
			mentionKey: 'sam',
			coMentionEntityIds: new Set(['e-samuel']),
			neighborEntityIds: neighbors
		});
		expect(score).toBe(7);
	});

	it('reuses adjacency sets when linking multiple edges for the same node', () => {
		const adj = buildEntityAdjacency([
			{ sourceId: 'e-a', targetId: 'e-b' },
			{ sourceId: 'e-a', targetId: 'e-c' }
		]);
		expect(adj.get('e-a')?.has('e-b')).toBe(true);
		expect(adj.get('e-a')?.has('e-c')).toBe(true);
	});

	it('reuses existing target adjacency when another edge points to it', () => {
		const adj = buildEntityAdjacency([
			{ sourceId: 'e-a', targetId: 'e-b' },
			{ sourceId: 'e-c', targetId: 'e-b' }
		]);
		expect(adj.get('e-b')?.has('e-a')).toBe(true);
		expect(adj.get('e-b')?.has('e-c')).toBe(true);
	});

	it('does not add lexical bonus without exact key match', () => {
		const score = scoreGraphLinkCandidate({
			candidateId: 'e-al',
			candidateEntityType: 'person',
			candidateCanonicalKey: 'al',
			mentionEntityType: 'person',
			mentionKey: 'alex',
			coMentionEntityIds: new Set(),
			neighborEntityIds: new Set()
		});
		expect(score).toBe(2);
	});
});
