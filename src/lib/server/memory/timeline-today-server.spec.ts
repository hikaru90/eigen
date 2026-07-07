import { describe, expect, it } from 'vitest';
import { filterOpenTodoTodayItems, isOpenTodoToday } from './timeline-today-server';
import type { TemporalEventListItem } from '$lib/server/memory/temporal-event-list';

function item(overrides: Partial<TemporalEventListItem> = {}): TemporalEventListItem {
	return {
		id: '1',
		itemType: 'event',
		kind: 'reminder',
		semanticSummary: 'Test',
		sourceTextSpan: null,
		timePrecision: 'exact',
		timezone: 'Europe/Berlin',
		isAllDay: false,
		confidence: 1,
		startAt: '2026-06-16T08:00:00.000Z',
		endAt: '2026-06-16T09:00:00.000Z',
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
		durationMinutes: 30,
		energyLevel: null,
		priorityQuadrant: null,
		contextTags: [],
		focusRank: null,
		parentEventId: null,
		memoryType: null,
		projectLabel: null,
		completedAt: null,
		lifecycleUpdatedAt: null,
		createdAt: '2026-06-16T07:00:00.000Z',
		author: 'user',
		authorLabel: null,
		...overrides
	};
}

describe('isOpenTodoToday', () => {
	const timeZone = 'Europe/Berlin';

	it('counts unscheduled open loops as today todo', () => {
		const now = new Date('2026-06-16T12:00:00.000Z');
		expect(isOpenTodoToday(item({ startAt: null, endAt: null, itemType: 'task' }), now, timeZone)).toBe(
			true
		);
	});

	it('includes overdue items still scheduled for today', () => {
		const now = new Date('2026-06-16T17:00:00.000Z');
		const overdueToday = item({
			startAt: '2026-06-16T08:00:00.000Z',
			endAt: '2026-06-16T09:00:00.000Z'
		});
		expect(isOpenTodoToday(overdueToday, now, timeZone)).toBe(true);
	});

	it('excludes items scheduled for a prior day', () => {
		const now = new Date('2026-06-16T17:00:00.000Z');
		const yesterday = item({
			startAt: '2026-06-15T08:00:00.000Z',
			endAt: '2026-06-15T09:00:00.000Z'
		});
		expect(isOpenTodoToday(yesterday, now, timeZone)).toBe(false);
	});

	it('includes upcoming items still due today', () => {
		const now = new Date('2026-06-16T12:00:00.000Z');
		const laterToday = item({
			startAt: '2026-06-16T18:00:00.000Z',
			endAt: '2026-06-16T19:00:00.000Z'
		});
		expect(isOpenTodoToday(laterToday, now, timeZone)).toBe(true);
	});
});

describe('filterOpenTodoTodayItems', () => {
	const timeZone = 'Europe/Berlin';

	it('merges prior-day overdue into today todo count', () => {
		const now = new Date('2026-06-16T17:00:00.000Z');
		const overdueYesterday = item({
			id: 'yesterday',
			startAt: '2026-06-15T08:00:00.000Z',
			endAt: '2026-06-15T09:00:00.000Z'
		});
		const upcoming = item({
			id: 'soon',
			startAt: '2026-06-16T20:00:00.000Z',
			endAt: '2026-06-16T21:00:00.000Z'
		});
		expect(filterOpenTodoTodayItems([overdueYesterday, upcoming], now, timeZone).map((i) => i.id)).toEqual(
			['soon', 'yesterday']
		);
	});
});
