import { describe, expect, it, vi } from 'vitest';
import {
	agendaSectionForItem,
	buildMonthGrid,
	calendarDateKey,
	eventDateKeys,
	eventsOnDay,
	filterActiveItems,
	filterItemsByRange,
	filterItemsByStatus,
	filterSnoozedItems,
	filterItemsForTodayView,
	filterItemsForUpcomingView,
	formatWhen,
	groupByAgendaSection,
	groupByKind,
	groupByMatrixQuadrant,
	groupByProject,
	localViewDayKey,
	overdueDebtMinutes,
	selectFocusItems,
	splitTodayFocusAndLater
} from './temporal-events-utils';
import type { TemporalEventListItem } from '../api/temporal-events/+server';

function item(overrides: Partial<TemporalEventListItem> = {}): TemporalEventListItem {
	return {
		id: '1',
		itemType: 'event',
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
		thoughtCategory: 'task',
		thoughtStatus: 'open',
		lifecycleStatus: 'open',
		snoozedUntil: null,
		recurrenceRule: null,
		durationMinutes: null,
		energyLevel: null,
		priorityQuadrant: null,
		contextTags: [],
		focusRank: null,
		parentEventId: null,
		memoryType: null,
		projectLabel: null,
		createdAt: '2026-05-19T00:00:00.000Z',
		...overrides
	};
}

describe('filterItemsByStatus', () => {
	it('hides completed events when filter is open', () => {
		const items = [
			item({ id: 'a', lifecycleStatus: 'open' }),
			item({ id: 'b', lifecycleStatus: 'completed' })
		];
		expect(filterItemsByStatus(items, 'open').map((i) => i.id)).toEqual(['a']);
	});

	it('hides cancelled events when filter is open', () => {
		const items = [
			item({ id: 'a', lifecycleStatus: 'open' }),
			item({ id: 'b', lifecycleStatus: 'cancelled' })
		];
		expect(filterItemsByStatus(items, 'open').map((i) => i.id)).toEqual(['a']);
	});

	it('includes completed events when filter is all', () => {
		const items = [
			item({ id: 'a', thoughtStatus: 'open' }),
			item({ id: 'b', thoughtStatus: 'completed' })
		];
		expect(filterItemsByStatus(items, 'all')).toHaveLength(2);
	});
});

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

describe('filterItemsByRange', () => {
	it('relevant includes upcoming and near-future items', () => {
		const now = new Date('2026-05-20T12:00:00.000Z');
		const items = [
			item({ id: 'past', startAt: '2026-05-01T00:00:00.000Z', endAt: '2026-05-02T00:00:00.000Z' }),
			item({ id: 'soon', startAt: '2026-05-25T00:00:00.000Z', endAt: '2026-05-26T00:00:00.000Z' })
		];
		vi.useFakeTimers();
		vi.setSystemTime(now);
		expect(filterItemsByRange(items, 'relevant').map((i) => i.id)).toEqual(['soon']);
		vi.useRealTimers();
	});
});

describe('groupByAgendaSection', () => {
	it('places same-day events in today section', () => {
		const now = new Date('2026-05-20T12:00:00.000Z');
		const todayItem = item({
			id: 'today',
			startAt: '2026-05-20T14:00:00.000Z',
			endAt: '2026-05-20T15:00:00.000Z',
			timePrecision: 'exact',
			isAllDay: false
		});
		const map = groupByAgendaSection([todayItem], 'UTC', now);
		expect(map.get('today')).toHaveLength(1);
		expect(agendaSectionForItem(todayItem, now, 'UTC')).toBe('today');
	});
});

describe('selectFocusItems', () => {
	it('prefers deadlines today over later items', () => {
		const now = new Date('2026-05-20T12:00:00.000Z');
		const deadlineToday = item({
			id: 'd1',
			kind: 'deadline',
			startAt: '2026-05-20T18:00:00.000Z',
			endAt: '2026-05-20T19:00:00.000Z',
			timePrecision: 'exact',
			isAllDay: false
		});
		const later = item({
			id: 'l1',
			startAt: '2026-06-01T00:00:00.000Z',
			endAt: '2026-06-02T00:00:00.000Z'
		});
		const focus = selectFocusItems([later, deadlineToday], 'UTC', 3, now);
		expect(focus[0]?.id).toBe('d1');
	});
});

describe('splitTodayFocusAndLater', () => {
	it('keeps top three open items in focus and the rest in later', () => {
		const now = new Date('2026-06-08T08:00:00.000Z');
		const items = [
			item({ id: 'a', startAt: '2026-06-08T09:00:00.000Z', endAt: '2026-06-08T10:00:00.000Z' }),
			item({ id: 'b', startAt: '2026-06-08T11:00:00.000Z', endAt: '2026-06-08T12:00:00.000Z' }),
			item({ id: 'c', startAt: '2026-06-08T13:00:00.000Z', endAt: '2026-06-08T14:00:00.000Z' }),
			item({ id: 'd', startAt: '2026-06-08T15:00:00.000Z', endAt: '2026-06-08T16:00:00.000Z' }),
			item({ id: 'e', startAt: '2026-06-08T17:00:00.000Z', endAt: '2026-06-08T18:00:00.000Z' })
		];
		const { focus, later } = splitTodayFocusAndLater(items, 'UTC', now);
		expect(focus.map((i) => i.id)).toEqual(['a', 'b', 'c']);
		expect(later.map((i) => i.id)).toEqual(['d', 'e']);
	});
});

describe('snooze filters', () => {
	it('filterSnoozedItems returns only snoozed rows', () => {
		const future = new Date(Date.now() + 60_000).toISOString();
		const items = [item({ id: 'a' }), item({ id: 'b', snoozedUntil: future })];
		expect(filterSnoozedItems(items).map((i) => i.id)).toEqual(['b']);
		expect(filterActiveItems(items).map((i) => i.id)).toEqual(['a']);
	});
});

describe('groupByMatrixQuadrant', () => {
	it('buckets by priorityQuadrant', () => {
		const items = [
			item({ id: '1', priorityQuadrant: 'urgent_important' }),
			item({ id: '2', priorityQuadrant: null })
		];
		const map = groupByMatrixQuadrant(items);
		expect(map.get('urgent_important')).toHaveLength(1);
		expect(map.get('unclassified')).toHaveLength(1);
	});
});

describe('groupByProject', () => {
	it('groups items by project label with fallback last', () => {
		const now = new Date('2026-06-08T12:00:00.000Z');
		const items = [
			item({ id: 'a', projectLabel: 'Eigen Mesh', startAt: null }),
			item({ id: 'b', projectLabel: 'LoRaWAN', startAt: null }),
			item({ id: 'c', projectLabel: null, startAt: null })
		];
		const groups = groupByProject(items, 'General', 'UTC', now);
		expect(groups).toHaveLength(3);
		expect(groups[0]?.projectLabel).toBe('Eigen Mesh');
		expect(groups[1]?.projectLabel).toBe('LoRaWAN');
		expect(groups[2]?.projectLabel).toBe('General');
	});
});

describe('filterItemsForTodayView', () => {
	it('includes today and unscheduled items', () => {
		const now = new Date('2026-06-08T12:00:00.000Z');
		const items = [
			item({
				id: 'today',
				startAt: '2026-06-08T10:00:00.000Z',
				endAt: '2026-06-08T14:00:00.000Z',
				isAllDay: false,
				timePrecision: 'minute'
			}),
			item({
				id: 'later',
				startAt: '2026-06-10T10:00:00.000Z',
				endAt: '2026-06-10T11:00:00.000Z',
				isAllDay: false,
				timePrecision: 'minute'
			}),
			item({ id: 'open', startAt: null, endAt: null })
		];
		const filtered = filterItemsForTodayView(items, 'UTC', now);
		expect(filtered.map((i) => i.id).sort()).toEqual(['open', 'today']);
	});
});

describe('filterItemsForUpcomingView', () => {
	it('includes future scheduled open items', () => {
		const now = new Date('2026-06-08T12:00:00.000Z');
		const items = [
			item({
				id: 'today',
				startAt: '2026-06-08T10:00:00.000Z',
				endAt: '2026-06-08T11:00:00.000Z',
				isAllDay: false,
				timePrecision: 'minute'
			}),
			item({
				id: 'later',
				startAt: '2026-06-10T10:00:00.000Z',
				endAt: '2026-06-10T11:00:00.000Z',
				isAllDay: false,
				timePrecision: 'minute'
			}),
			item({
				id: 'done',
				startAt: '2026-06-10T10:00:00.000Z',
				endAt: '2026-06-10T11:00:00.000Z',
				isAllDay: false,
				timePrecision: 'minute',
				lifecycleStatus: 'completed'
			})
		];
		const filtered = filterItemsForUpcomingView(items, 'UTC', now);
		expect(filtered.map((i) => i.id)).toEqual(['later']);
	});
});

describe('overdueDebtMinutes', () => {
	it('sums duration for overdue open events', () => {
		const now = new Date('2026-06-01T00:00:00.000Z');
		const items = [
			item({
				id: 'o1',
				endAt: '2026-05-20T00:00:00.000Z',
				durationMinutes: 90,
				lifecycleStatus: 'open'
			})
		];
		expect(overdueDebtMinutes(items, now)).toBe(90);
	});
});
