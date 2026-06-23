import { describe, expect, it } from 'vitest';
import {
	calendarDateInTimezone,
	formatScheduleLabel,
	localScheduleToUtc
} from './schedule-time';

describe('schedule-time', () => {
	it('formats calendar date in timezone', () => {
		const date = new Date('2026-06-23T14:00:00Z');
		expect(calendarDateInTimezone(date, 'UTC')).toBe('2026-06-23');
	});

	it('resolves UTC local schedule', () => {
		const instant = localScheduleToUtc('2026-06-23', 2, 0, 'UTC');
		expect(instant.toISOString()).toBe('2026-06-23T02:00:00.000Z');
	});

	it('formats default overnight label', () => {
		expect(formatScheduleLabel(2, 0, 'UTC')).toContain('2:00 AM');
	});
});
