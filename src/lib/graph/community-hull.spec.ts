import { describe, expect, it } from 'vitest';
import {
	COMMUNITY_LEAF_LEVEL,
	communityCircleFromPositions,
	communityHullChromeStyleForLevel,
	communityHullFill,
	communityHullFillOpacityForZoom,
	communityHullUsesRadialGradient,
	COMMUNITY_HULL_GRADIENT
} from './community-hull';

describe('COMMUNITY_HULL_GRADIENT', () => {
	it('keeps the white radial stops', () => {
		expect(COMMUNITY_HULL_GRADIENT.center).toContain('oklch(1 0 0');
		expect(COMMUNITY_HULL_GRADIENT.center).toContain('/ 0.88)');
	});
});

describe('communityHullUsesRadialGradient', () => {
	it('is true only for the leaf level', () => {
		expect(communityHullUsesRadialGradient(COMMUNITY_LEAF_LEVEL)).toBe(true);
		expect(communityHullUsesRadialGradient(1)).toBe(false);
		expect(communityHullUsesRadialGradient(0)).toBe(false);
	});
});

describe('communityHullFill', () => {
	it('uses the radial gradient at leaf and flat fills at higher levels', () => {
		expect(communityHullFill(COMMUNITY_LEAF_LEVEL)).toBe('url(#graph-community-fill)');
		expect(communityHullFill(1)).toContain('oklch(1 0 0');
		expect(communityHullFill(0)).toContain('oklch(1 0 0');
		expect(communityHullFill(1)).not.toContain('url(');
	});
});

describe('communityHullChromeStyleForLevel', () => {
	it('varies border weight and dash by level', () => {
		const leaf = communityHullChromeStyleForLevel(COMMUNITY_LEAF_LEVEL);
		const domain = communityHullChromeStyleForLevel(1);
		const root = communityHullChromeStyleForLevel(0);
		expect(leaf.strokeWidth).toBeLessThan(domain.strokeWidth);
		expect(domain.strokeWidth).toBeLessThan(root.strokeWidth);
		expect(leaf.strokeDasharray).not.toBe(root.strokeDasharray);
	});
});

describe('communityHullFillOpacityForZoom', () => {
	it('is full strength at or below unit zoom for leaf hulls', () => {
		expect(communityHullFillOpacityForZoom(1, COMMUNITY_LEAF_LEVEL)).toBe(1);
		expect(communityHullFillOpacityForZoom(0.5, COMMUNITY_LEAF_LEVEL)).toBe(1);
	});

	it('fades leaf hulls as zoom scale increases', () => {
		expect(communityHullFillOpacityForZoom(2, COMMUNITY_LEAF_LEVEL)).toBe(0.5);
		expect(communityHullFillOpacityForZoom(4, COMMUNITY_LEAF_LEVEL)).toBe(0.25);
		expect(communityHullFillOpacityForZoom(8, COMMUNITY_LEAF_LEVEL)).toBe(0.125);
	});

	it('stays opaque for non-leaf hull fills', () => {
		expect(communityHullFillOpacityForZoom(8, 1)).toBe(1);
		expect(communityHullFillOpacityForZoom(8, 0)).toBe(1);
	});
});

describe('communityCircleFromPositions', () => {
	it('returns null for empty positions', () => {
		expect(communityCircleFromPositions([])).toBeNull();
	});
});
