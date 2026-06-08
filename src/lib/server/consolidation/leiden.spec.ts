import { describe, expect, it } from 'vitest';
import { detectCommunities } from './leiden';
import type { Edge } from './leiden';
import { COMMUNITY_HIERARCHY_DEPTH } from './community-levels';

describe('detectCommunities', () => {
	it('returns trivial single-member communities for a single node', () => {
		const result = detectCommunities(['a'], [], COMMUNITY_HIERARCHY_DEPTH);
		expect(result.levels).toHaveLength(COMMUNITY_HIERARCHY_DEPTH);
		expect(result.levels[0].membership.get('a')).toBe('a');
	});

	it('returns trivial hierarchy for two unconnected nodes', () => {
		const result = detectCommunities(['a', 'b'], [], COMMUNITY_HIERARCHY_DEPTH);
		expect(result.levels).toHaveLength(COMMUNITY_HIERARCHY_DEPTH);
		for (const level of result.levels) {
			expect(level.membership.has('a')).toBe(true);
			expect(level.membership.has('b')).toBe(true);
		}
	});

	it('groups tightly connected nodes into same community at leaf level', () => {
		const nodes = ['a', 'b', 'c'];
		const edges: Edge[] = [
			{ sourceId: 'a', targetId: 'b', weight: 10 },
			{ sourceId: 'b', targetId: 'c', weight: 10 },
			{ sourceId: 'a', targetId: 'c', weight: 10 }
		];

		const result = detectCommunities(nodes, edges, COMMUNITY_HIERARCHY_DEPTH);
		const leafLevel = result.levels[0];

		const commA = leafLevel.membership.get('a');
		const commB = leafLevel.membership.get('b');
		const commC = leafLevel.membership.get('c');
		expect(commA).toBe(commB);
		expect(commB).toBe(commC);
	});

	it('separates weakly-connected clusters into different communities', () => {
		const nodes = ['a', 'b', 'c', 'd', 'e', 'f'];
		const edges: Edge[] = [
			{ sourceId: 'a', targetId: 'b', weight: 5 },
			{ sourceId: 'b', targetId: 'c', weight: 5 },
			{ sourceId: 'a', targetId: 'c', weight: 5 },
			{ sourceId: 'd', targetId: 'e', weight: 5 },
			{ sourceId: 'e', targetId: 'f', weight: 5 },
			{ sourceId: 'd', targetId: 'f', weight: 5 }
		];

		const result = detectCommunities(nodes, edges, COMMUNITY_HIERARCHY_DEPTH);
		const leafLevel = result.levels[0];

		const commA = leafLevel.membership.get('a');
		const commB = leafLevel.membership.get('b');
		const commC = leafLevel.membership.get('c');
		expect(commA).toBe(commB);
		expect(commB).toBe(commC);

		const commD = leafLevel.membership.get('d');
		const commE = leafLevel.membership.get('e');
		const commF = leafLevel.membership.get('f');
		expect(commD).toBe(commE);
		expect(commE).toBe(commF);
		expect(commA).not.toBe(commD);
	});

	it('produces 3 levels in the hierarchy', () => {
		const nodes = ['a', 'b', 'c', 'd'];
		const edges: Edge[] = [
			{ sourceId: 'a', targetId: 'b', weight: 3 },
			{ sourceId: 'c', targetId: 'd', weight: 3 }
		];

		const result = detectCommunities(nodes, edges, COMMUNITY_HIERARCHY_DEPTH);
		expect(result.levels).toHaveLength(COMMUNITY_HIERARCHY_DEPTH);
	});

	it('all nodes appear in membership at every level', () => {
		const nodes = ['a', 'b', 'c', 'd', 'e'];
		const edges: Edge[] = [
			{ sourceId: 'a', targetId: 'b', weight: 2 },
			{ sourceId: 'b', targetId: 'c', weight: 2 },
			{ sourceId: 'c', targetId: 'd', weight: 1 },
			{ sourceId: 'd', targetId: 'e', weight: 2 }
		];

		const result = detectCommunities(nodes, edges, COMMUNITY_HIERARCHY_DEPTH);
		for (const level of result.levels) {
			for (const node of nodes) {
				expect(level.membership.has(node)).toBe(true);
			}
		}
	});

	it('root level has fewer or equal communities than leaf level', () => {
		const nodes = ['a', 'b', 'c', 'd', 'e', 'f'];
		const edges: Edge[] = [
			{ sourceId: 'a', targetId: 'b', weight: 5 },
			{ sourceId: 'b', targetId: 'c', weight: 5 },
			{ sourceId: 'a', targetId: 'c', weight: 5 },
			{ sourceId: 'd', targetId: 'e', weight: 5 },
			{ sourceId: 'e', targetId: 'f', weight: 5 }
		];

		const result = detectCommunities(nodes, edges, COMMUNITY_HIERARCHY_DEPTH);
		const leafComms = new Set(result.levels[0].membership.values()).size;
		const rootComms = new Set(result.levels[COMMUNITY_HIERARCHY_DEPTH - 1].membership.values()).size;
		expect(rootComms).toBeLessThanOrEqual(leafComms);
	});

	it('ignores self-loops in edges', () => {
		const nodes = ['a', 'b'];
		const edges: Edge[] = [
			{ sourceId: 'a', targetId: 'a', weight: 100 },
			{ sourceId: 'a', targetId: 'b', weight: 1 }
		];

		const result = detectCommunities(nodes, edges, COMMUNITY_HIERARCHY_DEPTH);
		expect(result.levels[0].membership.has('a')).toBe(true);
		expect(result.levels[0].membership.has('b')).toBe(true);
	});

	it('handles empty edge list gracefully', () => {
		const nodes = ['a', 'b', 'c'];
		const result = detectCommunities(nodes, [], COMMUNITY_HIERARCHY_DEPTH);
		expect(result.levels).toHaveLength(COMMUNITY_HIERARCHY_DEPTH);
		const leafComms = new Set(result.levels[0].membership.values());
		expect(leafComms.size).toBe(3);
	});
});
