import { describe, expect, it } from 'vitest';
import { graphRearrangeProgressPercent } from './graph-rearrange-phases';

describe('graphRearrangeProgressPercent', () => {
	it('returns 0 before the first phase event', () => {
		expect(graphRearrangeProgressPercent([], false)).toBe(0);
	});

	it('counts only completed steps while the active step is still running', () => {
		expect(graphRearrangeProgressPercent(['prune_weak_edges'], false)).toBe(0);
		expect(graphRearrangeProgressPercent(['prune_weak_edges', 'prune_orphan_thoughts'], false)).toBe(
			17
		);
		expect(
			graphRearrangeProgressPercent(
				[
					'prune_weak_edges',
					'prune_orphan_thoughts',
					'prune_orphan_entities',
					'prune_duplicate_edges',
					'check_connections',
					'repair_relations'
				],
				false
			)
		).toBe(83);
	});

	it('interpolates progress within the active repair step', () => {
		const phases = [
			'prune_weak_edges',
			'prune_orphan_thoughts',
			'prune_orphan_entities',
			'prune_duplicate_edges',
			'check_connections',
			'repair_relations'
		] as const;

		expect(graphRearrangeProgressPercent(phases, false, { processed: 0, total: 60 })).toBe(83);
		expect(graphRearrangeProgressPercent(phases, false, { processed: 30, total: 60 })).toBe(92);
		expect(graphRearrangeProgressPercent(phases, false, { processed: 60, total: 60 })).toBe(99);
	});

	it('returns 100 when complete', () => {
		expect(graphRearrangeProgressPercent(['prune_weak_edges'], true)).toBe(100);
	});
});
