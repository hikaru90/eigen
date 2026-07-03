import { describe, expect, it } from 'vitest';
import { authorLegendItemStateClass, EIGEN_MESH_ACCENT } from './author-layer-chrome';

describe('author-layer-chrome', () => {
	it('authorLegendItemStateClass only dims unselected rows when filtering', () => {
		expect(authorLegendItemStateClass({ filterActive: true, isSelected: false })).toBe(
			'opacity-40'
		);
		expect(authorLegendItemStateClass({ filterActive: true, isSelected: true })).toBe('');
	});

	it('exports EigenMesh accent for agent icon styling', () => {
		expect(EIGEN_MESH_ACCENT).toBe('#28F97F');
	});
});
