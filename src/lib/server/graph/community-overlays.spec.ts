import { describe, expect, it } from 'vitest';
import { formatCommunityGraphName } from './community-overlays';

describe('formatCommunityGraphName', () => {
	it('uses member labels', () => {
		expect(
			formatCommunityGraphName({
				level: 2,
				memberLabels: ['Lilli', 'Pizza', 'Abend']
			})
		).toBe('Lilli, Pizza, Abend');
	});

	it('truncates long member lists', () => {
		expect(
			formatCommunityGraphName({
				level: 2,
				memberLabels: ['Very Long Entity Name Here', 'Another One', 'Third'],
				maxLen: 20
			})
		).toBe('Very Long Entity Na…');
	});

	it('falls back to cluster level', () => {
		expect(formatCommunityGraphName({ level: 1 })).toBe('Cluster L1');
	});
});
