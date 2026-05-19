import { describe, expect, it } from 'vitest';
import { inferQueryTimeRange, isTemporalQuery } from './temporal';

describe('isTemporalQuery', () => {
	it('detects when/deadline phrasing', () => {
		expect(isTemporalQuery('When did the saltwater sensor testing start?')).toBe(true);
		expect(isTemporalQuery('What is the project scope?')).toBe(false);
	});

	it('detects scheduling and conflict phrasing', () => {
		expect(isTemporalQuery('Is there a scheduling conflict?')).toBe(true);
		expect(isTemporalQuery('March schedule conflicts team')).toBe(true);
	});
});

describe('inferQueryTimeRange', () => {
	it('parses a calendar year window', () => {
		const range = inferQueryTimeRange('events in 2026');
		expect(range).not.toBeNull();
		expect(range?.start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
		expect(range?.end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
	});

	it('parses month + year', () => {
		const range = inferQueryTimeRange('events in May 2026');
		expect(range).not.toBeNull();
		expect(range?.start.getUTCMonth()).toBe(4);
	});

	it('parses month name without year using reference date', () => {
		const range = inferQueryTimeRange('March schedule conflicts team', new Date('2026-05-01T00:00:00Z'));
		expect(range).not.toBeNull();
		expect(range?.start.getUTCMonth()).toBe(2);
		expect(range?.start.getUTCFullYear()).toBe(2026);
	});
});
