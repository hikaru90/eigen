import { describe, expect, it } from 'vitest';
import {
	markOvernightJobActive,
	markOvernightJobInactive,
	isOvernightJobActiveInProcess
} from './active-overnight-jobs';
import { findOrphanedOvernightJobIds, isManualOvernightJob } from './recover-overnight';

describe('active-overnight-jobs', () => {
	it('tracks active jobs for the current process', () => {
		markOvernightJobActive('job-1');
		expect(isOvernightJobActiveInProcess('job-1')).toBe(true);
		markOvernightJobInactive('job-1');
		expect(isOvernightJobActiveInProcess('job-1')).toBe(false);
	});
});

describe('findOrphanedOvernightJobIds', () => {
	it('returns jobs not registered as active in this process', () => {
		markOvernightJobActive('job-live');
		expect(findOrphanedOvernightJobIds(['job-live', 'job-stale'])).toEqual(['job-stale']);
		markOvernightJobInactive('job-live');
	});
});

describe('isManualOvernightJob', () => {
	it('detects manual enqueue keys and payloads', () => {
		expect(isManualOvernightJob({ dedupeKey: 'manual:abc', payload: {} })).toBe(true);
		expect(
			isManualOvernightJob({ dedupeKey: 'overnight:2026-07-15', payload: { manual: true } })
		).toBe(true);
		expect(
			isManualOvernightJob({
				dedupeKey: 'overnight:2026-07-15',
				payload: { scheduled: true }
			})
		).toBe(false);
	});
});
