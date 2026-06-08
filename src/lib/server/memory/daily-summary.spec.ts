import { describe, expect, it } from 'vitest';
import { buildDailySummaryPush } from './daily-summary';
import type { TemporalEventListItem } from './temporal-event-list';
import {
	formatMinutesLocal,
	isOpenTodoToday,
	parseTimeLocalToMinutes
} from './timeline-today-server';

function item(overrides: Partial<TemporalEventListItem> = {}): TemporalEventListItem {
	return {
		id: '1',
		itemType: 'event',
		kind: 'appointment',
		semanticSummary: 'Standup',
		sourceTextSpan: null,
		timePrecision: 'minute',
		timezone: 'UTC',
		isAllDay: false,
		confidence: 1,
		startAt: '2026-06-08T10:00:00.000Z',
		endAt: '2026-06-08T11:00:00.000Z',
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
		createdAt: '2026-06-08T00:00:00.000Z',
		...overrides
	};
}

describe('buildDailySummaryPush', () => {
	it('summarizes today open items', () => {
		const now = new Date('2026-06-08T12:00:00.000Z');
		const push = buildDailySummaryPush(
			[
				item({ id: 'a', semanticSummary: 'Eigen Mesh sync' }),
				item({
					id: 'b',
					semanticSummary: 'Later task',
					startAt: '2026-06-10T10:00:00.000Z',
					endAt: '2026-06-10T11:00:00.000Z'
				})
			],
			'UTC',
			now
		);
		expect(push.title).toBe('Good morning');
		expect(push.body).toContain('1 task');
		expect(push.body).toContain('Eigen Mesh sync');
	});

	it('handles empty today list', () => {
		const now = new Date('2026-06-08T12:00:00.000Z');
		const push = buildDailySummaryPush([], 'UTC', now);
		expect(push.body).toContain('Nothing on your plate');
	});
});

describe('timeline-today-server helpers', () => {
	it('parses HH:MM to minutes', () => {
		expect(parseTimeLocalToMinutes('08:30')).toBe(510);
		expect(formatMinutesLocal(510)).toBe('08:30');
	});

	it('detects open todos scheduled today', () => {
		const now = new Date('2026-06-08T12:00:00.000Z');
		expect(isOpenTodoToday(item(), now, 'UTC')).toBe(true);
		expect(
			isOpenTodoToday(item({ lifecycleStatus: 'completed', thoughtStatus: 'completed' }), now, 'UTC')
		).toBe(false);
	});
});
