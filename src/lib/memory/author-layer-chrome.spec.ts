import { describe, expect, it } from 'vitest';
import {
	authorAgentChipClass,
	authorAgentChipClassSm,
	authorChipClassFor,
	authorLegendItemStateClass,
	authorUserChipClass,
	authorUserChipClassSm,
	EIGEN_MESH_ACCENT
} from './author-layer-chrome';

describe('author-layer-chrome', () => {
	it('authorLegendItemStateClass highlights selected rows when filtering', () => {
		expect(authorLegendItemStateClass({ filterActive: true, isSelected: false })).toBe('');
		expect(authorLegendItemStateClass({ filterActive: true, isSelected: true })).toBe(
			'bg-black/10 dark:bg-white/15'
		);
		expect(authorLegendItemStateClass({ filterActive: false, isSelected: false })).toBe('');
	});

	it('exports EigenMesh accent for agent icon styling', () => {
		expect(EIGEN_MESH_ACCENT).toBe('#22E876');
	});

	it('authorChipClassFor returns agent and user chip tokens by size', () => {
		expect(authorChipClassFor('agent')).toBe(authorAgentChipClass);
		expect(authorChipClassFor('agent', 'sm')).toBe(authorAgentChipClassSm);
		expect(authorChipClassFor('user')).toBe(authorUserChipClass);
		expect(authorChipClassFor('user', 'sm')).toBe(authorUserChipClassSm);
		expect(authorUserChipClass).toContain('rounded-full');
		expect(authorUserChipClassSm).toContain('text-[10px]');
	});
});
