import { describe, expect, it } from 'vitest';
import {
	DEFAULT_TIMEZONE_OFFSET_MINUTES,
	ianaFromOffsetMinutes,
	inferBrowserOffsetMinutes,
	nearestOptionOffset,
	offsetMinutesForIana,
	TIMEZONE_OFFSET_OPTIONS
} from './timezone-offset';

describe('timezone-offset', () => {
	it('exposes GMT-12 through GMT+14', () => {
		expect(TIMEZONE_OFFSET_OPTIONS[0]?.label).toBe('GMT-12');
		expect(TIMEZONE_OFFSET_OPTIONS.at(-1)?.label).toBe('GMT+14');
	});

	it('maps GMT+1 to Europe/Berlin', () => {
		expect(ianaFromOffsetMinutes(60)).toBe('Europe/Berlin');
	});

	it('defaults to GMT+1 minutes', () => {
		expect(DEFAULT_TIMEZONE_OFFSET_MINUTES).toBe(60);
	});

	it('reads offset from IANA', () => {
		const winter = new Date('2026-01-15T12:00:00.000Z');
		expect(offsetMinutesForIana('Europe/Berlin', winter)).toBe(60);
	});

	it('snaps inferred browser offset to whole hours', () => {
		const offset = inferBrowserOffsetMinutes();
		expect(offset % 60).toBe(0);
		expect(nearestOptionOffset(offset + 25)).toBe(offset);
	});
});
