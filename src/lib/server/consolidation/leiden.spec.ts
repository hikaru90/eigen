import { describe, expect, it } from 'vitest';
import { detectCommunities } from './leiden';
import type { Edge } from './leiden';

describe('detectCommunities', () => {
	it('returns trivial single-member communities for a single node', () => {
		const result = detectCommunities(['a'], [], 4);
		expect(result.levels).toHaveLength(4);
		expect(result.levels[0].membership.get('a')).toBe('a');
	});

	it('returns trivial hierarchy for two unconnected nodes', () => {
		const result = detectCommunities(['a', 'b'], [], 4);
		expect(result.levels).toHaveLength(4);
		// Both nodes exist in membership at all levels.
		for (const level of result.levels) {
			expect(level.membership.has('a')).toBe(true);
			expect(level.membership.has('b')).toBe(true);
		}
	});

	it('groups tightly connected nodes into same community at leaf level', () => {
		// Triangle: a-b-c strongly connected, d-e weakly connected to the triangle.
		const nodes = ['a', 'b', 'c'];
		const edges: Edge[] = [
			{ sourceId: 'a', targetId: 'b', weight: 10 },
			{ sourceId: 'b', targetId: 'c', weight: 10 },
			{ sourceId: 'a', targetId: 'c', weight: 10 }
		];

		const result = detectCommunities(nodes, edges, 4);
		const leafLevel = result.levels[0]; // L3

		// All three should end up in the same community given strong connections.
		const commA = leafLevel.membership.get('a');
		const commB = leafLevel.membership.get('b');
		const commC = leafLevel.membership.get('c');
		expect(commA).toBe(commB);
		expect(commB).toBe(commC);
	});

	it('separates weakly-connected clusters into different communities', () => {
		// Two clusters: {a,b,c} and {d,e,f} with no inter-cluster edges.
		const nodes = ['a', 'b', 'c', 'd', 'e', 'f'];
		const edges: Edge[] = [
			{ sourceId: 'a', targetId: 'b', weight: 5 },
			{ sourceId: 'b', targetId: 'c', weight: 5 },
			{ sourceId: 'a', targetId: 'c', weight: 5 },
			{ sourceId: 'd', targetId: 'e', weight: 5 },
			{ sourceId: 'e', targetId: 'f', weight: 5 },
			{ sourceId: 'd', targetId: 'f', weight: 5 }
		];

		const result = detectCommunities(nodes, edges, 4);
		const leafLevel = result.levels[0];

		// Cluster 1 should be together.
		const commA = leafLevel.membership.get('a');
		const commB = leafLevel.membership.get('b');
		const commC = leafLevel.membership.get('c');
		expect(commA).toBe(commB);
		expect(commB).toBe(commC);

		// Cluster 2 should be together.
		const commD = leafLevel.membership.get('d');
		const commE = leafLevel.membership.get('e');
		const commF = leafLevel.membership.get('f');
		expect(commD).toBe(commE);
		expect(commE).toBe(commF);

		// The two clusters should be in different communities.
		expect(commA).not.toBe(commD);
	});

	it('produces 4 levels in the hierarchy', () => {
		const nodes = ['a', 'b', 'c', 'd'];
		const edges: Edge[] = [
			{ sourceId: 'a', targetId: 'b', weight: 3 },
			{ sourceId: 'c', targetId: 'd', weight: 3 }
		];

		const result = detectCommunities(nodes, edges, 4);
		expect(result.levels).toHaveLength(4);
	});

	it('all nodes appear in membership at every level', () => {
		const nodes = ['a', 'b', 'c', 'd', 'e'];
		const edges: Edge[] = [
			{ sourceId: 'a', targetId: 'b', weight: 2 },
			{ sourceId: 'b', targetId: 'c', weight: 2 },
			{ sourceId: 'c', targetId: 'd', weight: 1 },
			{ sourceId: 'd', targetId: 'e', weight: 2 }
		];

		const result = detectCommunities(nodes, edges, 4);
		for (const level of result.levels) {
			for (const node of nodes) {
				expect(level.membership.has(node)).toBe(true);
			}
		}
	});

	it('root level (L0) has fewer or equal communities than leaf level (L3)', () => {
		const nodes = ['a', 'b', 'c', 'd', 'e', 'f'];
		const edges: Edge[] = [
			{ sourceId: 'a', targetId: 'b', weight: 5 },
			{ sourceId: 'b', targetId: 'c', weight: 5 },
			{ sourceId: 'a', targetId: 'c', weight: 5 },
			{ sourceId: 'd', targetId: 'e', weight: 5 },
			{ sourceId: 'e', targetId: 'f', weight: 5 }
		];

		const result = detectCommunities(nodes, edges, 4);
		const leafComms = new Set(result.levels[0].membership.values()).size;
		const rootComms = new Set(result.levels[3].membership.values()).size;
		expect(rootComms).toBeLessThanOrEqual(leafComms);
	});

	it('ignores self-loops in edges', () => {
		const nodes = ['a', 'b'];
		const edges: Edge[] = [
			{ sourceId: 'a', targetId: 'a', weight: 100 }, // self-loop
			{ sourceId: 'a', targetId: 'b', weight: 1 }
		];

		// Should not throw.
		const result = detectCommunities(nodes, edges, 4);
		expect(result.levels[0].membership.has('a')).toBe(true);
		expect(result.levels[0].membership.has('b')).toBe(true);
	});

	it('handles empty edge list gracefully', () => {
		const nodes = ['a', 'b', 'c'];
		const result = detectCommunities(nodes, [], 4);
		expect(result.levels).toHaveLength(4);
		// With no edges each node stays in its own community.
		const leafComms = new Set(result.levels[0].membership.values());
		expect(leafComms.size).toBe(3);
	});
});
