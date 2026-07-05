import { describe, expect, it } from 'vitest';
import {
	ianaFromOffsetMinutes,
	inferBrowserOffsetMinutes,
	labelForOffsetMinutes,
	nearestOptionOffset,
	offsetMinutesForIana,
	offsetMinutesForUiPreference,
	TIMEZONE_OFFSET_OPTIONS
} from './timezone-offset';

describe('timezone-offset', () => {
	it('exposes GMT-12 through GMT+14 with city names', () => {
		expect(TIMEZONE_OFFSET_OPTIONS[0]?.label).toContain('GMT-12');
		expect(TIMEZONE_OFFSET_OPTIONS.at(-1)?.label).toContain('GMT+14');
	});

	it('includes city names in parentheses when available', () => {
		const berlin = TIMEZONE_OFFSET_OPTIONS.find((o) => o.value === 60);
		expect(berlin?.label).toBe('GMT+1 (Berlin)');
		const ny = TIMEZONE_OFFSET_OPTIONS.find((o) => o.value === -300);
		expect(ny?.label).toBe('GMT-5 (New York)');
		const gmt0 = TIMEZONE_OFFSET_OPTIONS.find((o) => o.value === 0);
		expect(gmt0?.label).toBe('GMT (London)');
	});

	it('maps GMT+1 to a fixed Etc/GMT zone', () => {
		expect(ianaFromOffsetMinutes(60)).toBe('Etc/GMT-1');
	});

	it('maps GMT to Etc/GMT', () => {
		expect(ianaFromOffsetMinutes(0)).toBe('Etc/GMT');
		expect(offsetMinutesForIana('Etc/GMT')).toBe(0);
		expect(offsetMinutesForIana('UTC')).toBe(0);
	});

	it('labels offsets in GMT', () => {
		expect(labelForOffsetMinutes(60)).toBe('GMT+1 (Berlin)');
	});

	it('round-trips GMT+1 through storage in summer without DST drift', () => {
		const july = new Date('2026-07-05T12:00:00.000Z');
		expect(offsetMinutesForIana('Europe/Berlin', july)).toBe(120);
		const stored = ianaFromOffsetMinutes(60);
		expect(
			offsetMinutesForUiPreference(stored, 60, july)
		).toBe(60);
	});

	it('falls back to stored IANA when offset minutes are missing', () => {
		const july = new Date('2026-07-05T12:00:00.000Z');
		expect(offsetMinutesForUiPreference('Europe/Berlin', null, july)).toBe(120);
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
