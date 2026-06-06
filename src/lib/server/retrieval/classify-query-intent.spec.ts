import { describe, expect, it } from 'vitest';
import { parseQueryIntentResponse } from './classify-query-intent';

describe('parseQueryIntentResponse', () => {
	it('parses local temporal ordering intent', () => {
		const intent = parseQueryIntentResponse(
			JSON.stringify({
				scope: 'local',
				temporal: true,
				kind: 'ordering',
				entityHints: ['Samsung Galaxy S22', 'Dell XPS 13']
			})
		);
		expect(intent.scope).toBe('local');
		expect(intent.temporal).toBe(true);
		expect(intent.kind).toBe('ordering');
		expect(intent.entityHints).toEqual(['Samsung Galaxy S22', 'Dell XPS 13']);
		expect(intent.timeWindow).toBeNull();
	});

	it('parses duration intent with time window', () => {
		const intent = parseQueryIntentResponse(
			JSON.stringify({
				scope: 'local',
				temporal: true,
				kind: 'duration',
				entityHints: ['team meeting', 'workshop'],
				timeWindowStart: '2023-01-01T00:00:00.000Z',
				timeWindowEnd: '2023-02-01T00:00:00.000Z'
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
});
