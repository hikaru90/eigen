import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getTemporalAnchorTimezone } from './temporal-anchor-timezone';

describe('getTemporalAnchorTimezone', () => {
	const original = process.env.TEMPORAL_ANCHOR_TZ;

	beforeEach(() => {
		delete process.env.TEMPORAL_ANCHOR_TZ;
	});

	afterEach(() => {
		if (original === undefined) {
			delete process.env.TEMPORAL_ANCHOR_TZ;
		} else {
			process.env.TEMPORAL_ANCHOR_TZ = original;
		}
	});

	it('falls back to UTC when unset', () => {
		expect(getTemporalAnchorTimezone()).toBe('UTC');
	});

	it('falls back to UTC when set to whitespace', () => {
		process.env.TEMPORAL_ANCHOR_TZ = '   ';
		expect(getTemporalAnchorTimezone()).toBe('UTC');
	});

	it('trims and returns the configured timezone', () => {
		process.env.TEMPORAL_ANCHOR_TZ = '  Europe/Berlin  ';
		expect(getTemporalAnchorTimezone()).toBe('Europe/Berlin');
	});
});
