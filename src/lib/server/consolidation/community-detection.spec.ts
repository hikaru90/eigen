import { describe, expect, it } from 'vitest';
import {
	buildCommunitySignature,
	buildMemberSignature
} from './community-detection';

describe('buildMemberSignature', () => {
	it('sorts member ids deterministically', () => {
		expect(buildMemberSignature(['b', 'a', 'c'])).toBe('a,b,c');
	});
});

describe('buildCommunitySignature', () => {
	it('includes level prefix', () => {
		expect(buildCommunitySignature(1, ['e1', 'e2'])).toBe('L1:e1,e2');
	});
});

describe('community signature matching', () => {
	it('matches identical member sets at the same level', () => {
		const a = buildCommunitySignature(1, ['e1', 'e2']);
		const b = buildCommunitySignature(1, ['e2', 'e1']);
		expect(a).toBe(b);
	});

	it('does not match different levels with same members', () => {
		const l1 = buildCommunitySignature(1, ['e1', 'e2']);
		const l2 = buildCommunitySignature(2, ['e1', 'e2']);
		expect(l1).not.toBe(l2);
	});
});
