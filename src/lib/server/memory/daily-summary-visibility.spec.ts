import { describe, expect, it } from 'vitest';
import {
	dailySummaryDispatchReasonLabel,
	evaluateDailySummaryDispatch
} from './daily-summary-visibility';

describe('evaluateDailySummaryDispatch', () => {
	const base = {
		now: new Date('2026-07-06T08:05:00.000Z'),
		timeZone: 'Etc/GMT-1',
		dailySummaryMinutesLocal: 540,
		lastDailySummaryLocalDate: null as string | null,
		lastDailySummaryDispatchError: null as string | null,
		pushDeviceCount: 1
	};

	it('marks due_now inside the dispatch window', () => {
		const result = evaluateDailySummaryDispatch(base);
		expect(result.reason).toBe('due_now');
		expect(result.wouldDispatch).toBe(true);
		expect(result.scheduledTimeLocal).toBe('09:00');
	});

	it('marks before_window when local time is earlier', () => {
		const result = evaluateDailySummaryDispatch({
			...base,
			now: new Date('2026-07-06T06:30:00.000Z')
		});
		expect(result.reason).toBe('before_window');
		expect(result.wouldDispatch).toBe(false);
	});

	it('still dispatches after the nominal morning window (catch-up same day)', () => {
		const result = evaluateDailySummaryDispatch({
			...base,
			now: new Date('2026-07-06T08:15:00.000Z')
		});
		expect(result.reason).toBe('due_now');
		expect(result.wouldDispatch).toBe(true);
	});

	it('marks sent_today only when delivered without a dispatch error', () => {
		const result = evaluateDailySummaryDispatch({
			...base,
			lastDailySummaryLocalDate: '2026-07-06'
		});
		expect(result.reason).toBe('sent_today');
		expect(result.wouldDispatch).toBe(false);
	});

	it('retries when last send failed even if a stale sent date is present', () => {
		const result = evaluateDailySummaryDispatch({
			...base,
			lastDailySummaryLocalDate: '2026-07-06',
			lastDailySummaryDispatchError: 'Push delivery failed: all endpoints failed'
		});
		expect(result.reason).toBe('send_failed');
		expect(result.wouldDispatch).toBe(true);
	});

	it('marks no_push_device when count is zero', () => {
		const result = evaluateDailySummaryDispatch({
			...base,
			pushDeviceCount: 0
		});
		expect(result.reason).toBe('no_push_device');
		expect(dailySummaryDispatchReasonLabel(result.reason)).toContain('push device');
	});
});
