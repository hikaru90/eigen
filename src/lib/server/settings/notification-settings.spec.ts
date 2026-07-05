import { describe, expect, it } from 'vitest';
import { parseNotificationSettingsBody } from './notification-settings';

describe('parseNotificationSettingsBody', () => {
	it('parses a valid payload', () => {
		expect(
			parseNotificationSettingsBody({
				timezoneOffsetMinutes: 120,
				eventNotificationsEnabled: true,
				eventReminderLeadMinutes: 15,
				dailySummaryEnabled: true,
				dailySummaryTimeLocal: '08:30'
			})
		).toEqual({
			timezoneOffsetMinutes: 120,
			eventNotificationsEnabled: true,
			eventReminderLeadMinutes: 15,
			dailySummaryEnabled: true,
			dailySummaryTimeLocal: '08:30'
		});
	});

	it('rejects invalid lead minutes', () => {
		expect(() =>
			parseNotificationSettingsBody({
				timezoneOffsetMinutes: 60,
				eventNotificationsEnabled: false,
				eventReminderLeadMinutes: 0,
				dailySummaryEnabled: false,
				dailySummaryTimeLocal: '08:00'
			})
		).toThrow(/at least 1 minute/);
	});

	it('rejects invalid summary time', () => {
		expect(() =>
			parseNotificationSettingsBody({
				timezoneOffsetMinutes: 60,
				eventNotificationsEnabled: false,
				eventReminderLeadMinutes: 10,
				dailySummaryEnabled: true,
				dailySummaryTimeLocal: 'invalid'
			})
		).toThrow(/HH:MM/);
	});
});
