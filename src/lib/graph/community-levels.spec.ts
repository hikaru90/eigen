import { describe, expect, it } from 'vitest';
import {
	canonicalCommunityLevels,
	COMMUNITY_LEAF_LEVEL,
	COMMUNITY_LEVEL_SCHEMA,
	communityLevelFilterLabel,
	isCommunityDbLevel
} from './community-levels';

describe('community-levels (graph)', () => {
	it('defines exactly three canonical levels', () => {
		expect(COMMUNITY_LEVEL_SCHEMA).toEqual([2, 1, 0]);
		expect(COMMUNITY_LEAF_LEVEL).toBe(2);
	});

	it('rejects stale hierarchy levels from data', () => {
		expect(isCommunityDbLevel(3)).toBe(false);
		expect(isCommunityDbLevel(2)).toBe(true);
	});

	it('returns canonical levels in leaf→root order', () => {
		expect(canonicalCommunityLevels([0, 2, 3, 1])).toEqual([2, 1, 0]);
		expect(canonicalCommunityLevels([2])).toEqual([2]);
	});

	it('labels each filter option distinctly', () => {
		expect(communityLevelFilterLabel(2)).toContain('leaf');
		expect(communityLevelFilterLabel(1)).toContain('domain');
		expect(communityLevelFilterLabel(0)).toContain('root');
	});
});
