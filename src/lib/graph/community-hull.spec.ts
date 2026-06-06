import { describe, expect, it } from 'vitest';
import {
	communityCircleFromPositions,
	communityHullFillOpacityForZoom,
	COMMUNITY_HULL_GRADIENT
} from './community-hull';

describe('COMMUNITY_HULL_GRADIENT', () => {
	it('keeps the white radial stops', () => {
		expect(COMMUNITY_HULL_GRADIENT.center).toContain('oklch(1 0 0');
		expect(COMMUNITY_HULL_GRADIENT.center).toContain('/ 0.88)');
	});
});

describe('communityHullFillOpacityForZoom', () => {
	it('is full strength at or below unit zoom', () => {
		expect(communityHullFillOpacityForZoom(1)).toBe(1);
		expect(communityHullFillOpacityForZoom(0.5)).toBe(1);
	});

	it('fades as zoom scale increases', () => {
		expect(communityHullFillOpacityForZoom(2)).toBe(0.5);
		expect(communityHullFillOpacityForZoom(4)).toBe(0.25);
		expect(communityHullFillOpacityForZoom(8)).toBe(0.125);
	});
});

describe('communityCircleFromPositions', () => {
	it('returns null for empty positions', () => {
		expect(communityCircleFromPositions([])).toBeNull();
	});
});
