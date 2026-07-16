import { describe, expect, it } from 'vitest';
import { expandRruleOccurrences } from './temporal-rrule';

describe('temporal-rrule re-export', () => {
	it('re-exports expandRruleOccurrences from $lib/graph/temporal-rrule', () => {
		expect(typeof expandRruleOccurrences).toBe('function');

		const dtstart = new Date('2026-01-01T09:00:00.000Z');
		const occurrences = expandRruleOccurrences({
			rrule: 'FREQ=DAILY;COUNT=3',
			dtstart,
			rangeStart: dtstart,
			rangeEnd: new Date('2026-01-10T00:00:00.000Z')
		});
		expect(occurrences).toHaveLength(3);
	});
});
