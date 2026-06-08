import { describe, expect, it } from 'vitest';
import { parseQueryIntentResponse } from './classify-query-intent';

describe('parseQueryIntentResponse', () => {
	it('parses local temporal ordering intent', () => {
		const intent = parseQueryIntentResponse(
			JSON.stringify({
				scope: 'local',
				temporal: true,
				kind: 'ordering',
				entityHints: ['Samsung Galaxy S22', 'Dell XPS 13'],
				comparativeOrdering: true
			})
		);
		expect(intent.scope).toBe('local');
		expect(intent.temporal).toBe(true);
		expect(intent.kind).toBe('ordering');
		expect(intent.entityHints).toEqual(['Samsung Galaxy S22', 'Dell XPS 13']);
		expect(intent.timeWindow).toBeNull();
		expect(intent.durationUnit).toBeNull();
		expect(intent.comparativeOrdering).toBe(true);
	});

	it('parses count and lookback kinds with durationUnit', () => {
		const count = parseQueryIntentResponse(
			JSON.stringify({
				scope: 'local',
				temporal: true,
				kind: 'count',
				entityHints: ['Run for the Cure'],
				durationUnit: null,
				comparativeOrdering: false
			})
		);
		expect(count.kind).toBe('count');

		const lookback = parseQueryIntentResponse(
			JSON.stringify({
				scope: 'local',
				temporal: true,
				kind: 'lookback',
				entityHints: ['Airbnb in San Francisco'],
				durationUnit: 'months',
				comparativeOrdering: false
			})
		);
		expect(lookback.kind).toBe('lookback');
		expect(lookback.durationUnit).toBe('months');
	});

	it('parses duration intent with time window', () => {
		const intent = parseQueryIntentResponse(
			JSON.stringify({
				scope: 'local',
				temporal: true,
				kind: 'duration',
				entityHints: ['team meeting', 'workshop'],
				timeWindowStart: '2023-01-01T00:00:00.000Z',
				timeWindowEnd: '2023-02-01T00:00:00.000Z',
				comparativeOrdering: false
			})
		);
		expect(intent.kind).toBe('duration');
		expect(intent.timeWindow?.start.toISOString()).toBe('2023-01-01T00:00:00.000Z');
		expect(intent.timeWindow?.end.toISOString()).toBe('2023-02-01T00:00:00.000Z');
	});

	it('rejects invalid scope', () => {
		expect(() =>
			parseQueryIntentResponse(JSON.stringify({ scope: 'hybrid', temporal: false, kind: 'none', entityHints: [] }))
		).toThrow(/scope must be/);
	});

	it('treats invalid or placeholder time window bounds as omitted', () => {
		const intent = parseQueryIntentResponse(
			JSON.stringify({
				scope: 'local',
				temporal: true,
				kind: 'ordering',
				entityHints: ['event A', 'event B'],
				timeWindowStart: 'omit',
				timeWindowEnd: 'unknown',
				comparativeOrdering: true
			})
		);
		expect(intent.timeWindow).toBeNull();
	});

	it('ignores a lone valid window bound without the pair', () => {
		const intent = parseQueryIntentResponse(
			JSON.stringify({
				scope: 'local',
				temporal: true,
				kind: 'absolute',
				entityHints: [],
				timeWindowStart: '2023-06-01T00:00:00.000Z',
				comparativeOrdering: false
			})
		);
		expect(intent.timeWindow).toBeNull();
	});

	it('preserves German entityHints verbatim from classifier output', () => {
		const intent = parseQueryIntentResponse(
			JSON.stringify({
				scope: 'local',
				temporal: true,
				kind: 'ordering',
				entityHints: ['Fahrrad', 'Auto'],
				durationUnit: null,
				comparativeOrdering: true
			})
		);
		expect(intent.entityHints).toEqual(['Fahrrad', 'Auto']);
		expect(intent.comparativeOrdering).toBe(true);
	});

	it('parses Walk for Hunger / Coastal Cleanup duration intent', () => {
		const intent = parseQueryIntentResponse(
			JSON.stringify({
				scope: 'local',
				temporal: true,
				kind: 'duration',
				entityHints: ['Walk for Hunger', 'Coastal Cleanup'],
				durationUnit: 'days',
				comparativeOrdering: false
			})
		);
		expect(intent.kind).toBe('duration');
		expect(intent.entityHints).toEqual(['Walk for Hunger', 'Coastal Cleanup']);
		expect(intent.durationUnit).toBe('days');
	});

	it('parses NovaTech span intent (not lookback)', () => {
		const intent = parseQueryIntentResponse(
			JSON.stringify({
				scope: 'local',
				temporal: true,
				kind: 'span',
				entityHints: ['working professionally', 'NovaTech'],
				durationUnit: null,
				comparativeOrdering: false
			})
		);
		expect(intent.kind).toBe('span');
		expect(intent.entityHints).toContain('NovaTech');
	});

	it('parses book ordering intent with comparativeOrdering true', () => {
		const intent = parseQueryIntentResponse(
			JSON.stringify({
				scope: 'local',
				temporal: true,
				kind: 'ordering',
				entityHints: ['The Hate U Give', 'The Nightingale'],
				durationUnit: null,
				comparativeOrdering: true
			})
		);
		expect(intent.kind).toBe('ordering');
		expect(intent.comparativeOrdering).toBe(true);
	});

	it('parses Rachel house duration with semantic entityHints', () => {
		const intent = parseQueryIntentResponse(
			JSON.stringify({
				scope: 'local',
				temporal: true,
				kind: 'duration',
				entityHints: ['starting to work with Rachel', 'find a house I loved'],
				durationUnit: 'days',
				comparativeOrdering: false
			})
		);
		expect(intent.kind).toBe('duration');
		expect(intent.entityHints).toEqual([
			'starting to work with Rachel',
			'find a house I loved'
		]);
	});
});
