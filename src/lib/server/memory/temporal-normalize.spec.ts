import { describe, expect, it } from 'vitest';
import {
	buildActivePeriodLiteral,
	parseTemporalMentions,
	resolveTemporalBounds
} from './temporal-normalize';

describe('parseTemporalMentions', () => {
	it('parses valid temporal mentions and filters invalid kinds', () => {
		const out = parseTemporalMentions(
			`[
				{"surface":"due Friday","kind":"deadline","startAt":"2026-05-22T00:00:00.000Z","timePrecision":"day","timezone":"UTC","isAllDay":true,"confidence":0.9,"semanticSummary":"Report due Friday"},
				{"surface":"bad","kind":"not_a_kind","startAt":"2026-05-22T00:00:00.000Z","timePrecision":"day","timezone":"UTC","confidence":1,"semanticSummary":"x"}
			]`
		);
		expect(out).toHaveLength(1);
		expect(out[0]?.kind).toBe('deadline');
		expect(out[0]?.isAllDay).toBe(true);
	});

	it('throws when JSON is not an array', () => {
		expect(() => parseTemporalMentions('{}')).toThrow(/must be a JSON array/);
	});
});

describe('resolveTemporalBounds', () => {
	it('returns a half-open tsrange literal for a deadline', () => {
		const bounds = resolveTemporalBounds({
			surface: 'due Friday',
			kind: 'deadline',
			startAt: '2026-05-22T12:00:00.000Z',
			timePrecision: 'exact',
			timezone: 'UTC',
			isAllDay: false,
			confidence: 1,
			semanticSummary: 'Report due Friday'
		});
		expect(bounds.end.getTime()).toBeGreaterThan(bounds.start.getTime());
		expect(bounds.activePeriodLiteral).toMatch(/^\[.+,.+\)$/);
		expect(buildActivePeriodLiteral(bounds.start, bounds.end)).toBe(bounds.activePeriodLiteral);
	});

	it('uses a fuzzy window when endAt is omitted', () => {
		const bounds = resolveTemporalBounds({
			surface: 'sometime next month',
			kind: 'period',
			startAt: '2026-06-01T00:00:00.000Z',
			timePrecision: 'fuzzy',
			timezone: 'UTC',
			isAllDay: true,
			confidence: 0.7,
			semanticSummary: 'Vacation sometime next month'
		});
		expect(bounds.end.getTime() - bounds.start.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
	});
});
