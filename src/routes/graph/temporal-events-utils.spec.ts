import { describe, expect, it } from 'vitest';
import {
	buildMonthGrid,
	calendarDateKey,
	eventDateKeys,
	eventsOnDay,
	formatWhen,
	groupByKind,
	localViewDayKey
} from './temporal-events-utils';
import type { TemporalEventListItem } from '../api/temporal-events/+server';

function item(overrides: Partial<TemporalEventListItem> = {}): TemporalEventListItem {
	return {
		id: '1',
		kind: 'appointment',
		semanticSummary: 'Test',
		sourceTextSpan: null,
		timePrecision: 'day',
		timezone: 'UTC',
		isAllDay: true,
		confidence: 1,
		startAt: '2026-05-20T00:00:00.000Z',
		endAt: '2026-05-21T00:00:00.000Z',
		activePeriod: '',
		graphSyncStatus: 'synced',
		graphSyncError: null,
		thoughtId: 't1',
		thoughtText: 'thought',
		createdAt: '2026-05-19T00:00:00.000Z',
		...overrides
	};
}

function day(year: number, month: number, date: number): Date {
	return new Date(year, month - 1, date);
}

describe('calendarDateKey', () => {
	it('maps UTC midnight to the UTC calendar date', () => {
		expect(calendarDateKey('2026-05-20T00:00:00.000Z', 'UTC')).toBe('2026-05-20');
	});
});

describe('eventDateKeys', () => {
	it('uses half-open range for single UTC all-day day', () => {
		expect(eventDateKeys(item())).toEqual({
			startKey: '2026-05-20',
			endKey: '2026-05-21'
		});
	});
});

describe('eventsOnDay', () => {
	it('shows UTC all-day event on exactly one local grid day (May 20)', () => {
		const ev = item();
		const hits = [18, 19, 20, 21, 22].map((d) => ({
			day: d,
			count: eventsOnDay([ev], day(2026, 5, d)).length
		}));
		expect(hits.find((h) => h.day === 20)?.count).toBe(1);
		expect(hits.filter((h) => h.count > 0)).toHaveLength(1);
		expect(hits.find((h) => h.day === 20)?.count).toBe(1);
	});

	it('does not duplicate across adjacent local days regardless of host TZ', () => {
		const ev = item();
		let hitDays = 0;
		for (let d = 1; d <= 31; d++) {
			if (eventsOnDay([ev], day(2026, 5, d)).length > 0) hitDays++;
		}
		expect(hitDays).toBe(1);
	});

	it('matches event timezone calendar dates to local view keys', () => {
		const ev = item({
			timezone: 'UTC',
			startAt: '2026-05-20T00:00:00.000Z',
			endAt: '2026-05-21T00:00:00.000Z'
		});
		const keys = eventDateKeys(ev)!;
		const viewMay20 = localViewDayKey(day(2026, 5, 20));
		expect(viewMay20 >= keys.startKey && viewMay20 < keys.endKey).toBe(true);
	});

	it('places timed appointment on a single local day', () => {
		const ev = item({
			isAllDay: false,
			timePrecision: 'exact',
			timezone: 'UTC',
			startAt: '2026-05-20T15:00:00.000Z',
			endAt: '2026-05-20T16:00:00.000Z'
		});
		expect(eventsOnDay([ev], day(2026, 5, 20))).toHaveLength(1);
		expect(eventsOnDay([ev], day(2026, 5, 19))).toHaveLength(0);
		expect(eventsOnDay([ev], day(2026, 5, 21))).toHaveLength(0);
	});

	it('ignores items with null startAt', () => {
		const ev = item({ startAt: null });
		expect(eventsOnDay([ev], day(2026, 5, 20))).toHaveLength(0);
	});
});

describe('formatWhen', () => {
	it('formats all-day dates in event timezone', () => {
		const label = formatWhen(item());
		expect(label).toMatch(/May/);
		expect(label).toMatch(/20/);
	});
});

describe('groupByKind', () => {
	it('groups items into kind columns', () => {
		const map = groupByKind([
			item({ id: 'a', kind: 'deadline' }),
			item({ id: 'b', kind: 'appointment' })
		]);
		expect(map.get('deadline')).toHaveLength(1);
		expect(map.get('appointment')).toHaveLength(1);
	});
});

describe('buildMonthGrid', () => {
	it('returns 42 cells for a month grid', () => {
		expect(buildMonthGrid(new Date(2026, 4, 1))).toHaveLength(42);
	});
});
