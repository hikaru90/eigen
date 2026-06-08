import { describe, expect, it } from 'vitest';
import { formatCommunityGraphName } from './community-overlays';

describe('formatCommunityGraphName', () => {
	it('prefers summary title over member labels', () => {
		expect(
			formatCommunityGraphName({
				level: 2,
				summaryShort: 'Family dinners and routines',
				memberLabels: ['Lilli', 'Pizza', 'Abend']
			})
		).toBe('Family dinners and routines');
	});

	it('falls back to member labels when no summary', () => {
		expect(
			formatCommunityGraphName({
				level: 2,
				memberLabels: ['Lilli', 'Pizza', 'Abend']
			})
		).toBe('Lilli, Pizza, Abend');
	});

	it('truncates long titles', () => {
		expect(
			formatCommunityGraphName({
				level: 2,
				summaryShort: 'Very Long Thematic Community Title Here',
				maxLen: 20
			})
		).toBe('Very Long Thematic …');
	});

	it('falls back to cluster level', () => {
		expect(formatCommunityGraphName({ level: 1 })).toBe('Cluster L1');
	});
});
