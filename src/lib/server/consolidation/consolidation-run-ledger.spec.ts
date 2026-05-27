import { afterEach, describe, expect, it, vi } from 'vitest';
import { consolidationRunNightForDate } from './consolidation-run-ledger';

describe('consolidationRunNightForDate', () => {
	const prevTz = process.env.CONSOLIDATION_CRON_TZ;

	afterEach(() => {
		if (prevTz === undefined) {
			delete process.env.CONSOLIDATION_CRON_TZ;
		} else {
			process.env.CONSOLIDATION_CRON_TZ = prevTz;
		}
	});

	it('formats calendar date in UTC by default', () => {
		delete process.env.CONSOLIDATION_CRON_TZ;
		const night = consolidationRunNightForDate(new Date('2026-05-27T01:30:00Z'));
		expect(night).toBe('2026-05-27');
	});

	it('respects CONSOLIDATION_CRON_TZ', () => {
		process.env.CONSOLIDATION_CRON_TZ = 'America/New_York';
		// 2026-05-27 06:00 UTC = 2026-05-27 02:00 EDT
		const night = consolidationRunNightForDate(new Date('2026-05-27T06:00:00Z'));
		expect(night).toBe('2026-05-27');
	});
});
