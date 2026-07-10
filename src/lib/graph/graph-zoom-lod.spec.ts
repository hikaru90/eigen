import { describe, expect, it } from 'vitest';
import {
	clustersForZoomLod,
	communityClustersForLevel,
	graphClusterBadgeRadius,
	graphZoomClusterExitScale,
	graphZoomClusterLevelForScale,
	graphZoomLodMode,
	spatialClustersFromNodes
} from './graph-zoom-lod';

describe('graphZoomLodMode', () => {
	it('enters cluster mode below the coarse-pointer threshold', () => {
		expect(graphZoomLodMode(0.35, true, 'nodes')).toBe('clusters');
		expect(graphZoomLodMode(0.45, true, 'clusters')).toBe('clusters');
		expect(graphZoomLodMode(0.49, true, 'clusters')).toBe('nodes');
	});

	it('uses hysteresis on fine pointers', () => {
		expect(graphZoomLodMode(0.25, false, 'nodes')).toBe('clusters');
		expect(graphZoomLodMode(0.35, false, 'clusters')).toBe('clusters');
		expect(graphZoomLodMode(0.37, false, 'clusters')).toBe('nodes');
	});
});

describe('graphZoomClusterLevelForScale', () => {
	it('picks coarser levels when zoomed further out', () => {
		expect(graphZoomClusterLevelForScale(0.1, [2, 1, 0])).toBe(0);
		expect(graphZoomClusterLevelForScale(0.22, [2, 1, 0])).toBe(1);
		expect(graphZoomClusterLevelForScale(0.4, [2, 1, 0])).toBe(2);
	});
});

describe('communityClustersForLevel', () => {
	it('builds hulls from member positions', () => {
		const clusters = communityClustersForLevel(
			[
				{
					id: 'c1',
					level: 2,
					name: 'Work',
					description: null,
					memberEntityIds: ['a', 'b']
				}
			],
			new Map([
				['a', { x: 0, y: 0 }],
				['b', { x: 20, y: 0 }]
			]),
			2
		);
		expect(clusters).toHaveLength(1);
		expect(clusters[0]?.memberCount).toBe(2);
		expect(clusters[0]?.name).toBe('Work');
	});
});

describe('spatialClustersFromNodes', () => {
	it('groups nearby nodes into one spatial cluster', () => {
		const clusters = spatialClustersFromNodes(
			[
				{ id: 'a', x: 10, y: 10, label: 'Alpha' },
				{ id: 'b', x: 12, y: 14, label: 'Beta' }
			],
			80
		);
		expect(clusters).toHaveLength(1);
		expect(clusters[0]?.memberCount).toBe(2);
	});
});

describe('clustersForZoomLod', () => {
	it('falls back to spatial clusters when communities are missing', () => {
		const clusters = clustersForZoomLod(
			[],
			[
				{ id: 'a', x: 0, y: 0 },
				{ id: 'b', x: 8, y: 6 }
			],
			0.4,
			[],
			true
		);
		expect(clusters.length).toBeGreaterThan(0);
	});
});

describe('graphClusterBadgeRadius', () => {
	it('grows sublinearly with member count', () => {
		expect(graphClusterBadgeRadius(1)).toBeLessThan(graphClusterBadgeRadius(16));
		expect(graphClusterBadgeRadius(100)).toBeLessThanOrEqual(28);
	});
});

describe('graphZoomClusterExitScale', () => {
	it('returns a higher exit threshold on coarse pointers', () => {
		expect(graphZoomClusterExitScale(true)).toBeGreaterThan(graphZoomClusterExitScale(false));
	});
});
