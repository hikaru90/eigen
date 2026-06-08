import { describe, expect, it } from 'vitest';
import {
	parseTemporalHintBindingsResponse,
	pruneTemporalBindingCandidates,
	filterBindingCandidatesForKind,
	prepareBindingCandidates
} from './resolve-temporal-hint-bindings';

const candidates = [
	{
		eventId: 'ev-bike',
		thoughtId: 't-bike',
		semanticSummary: 'Fahrradreparatur Mitte Februar',
		startAt: '2023-02-15T00:00:00.000Z',
		kind: 'milestone' as const
	},
	{
		eventId: 'ev-car',
		thoughtId: 't-car',
		semanticSummary: 'Autowäsche für Toyota Corolla am 27. Februar',
		startAt: '2023-02-27T00:00:00.000Z',
		kind: 'milestone' as const
	}
];

describe('parseTemporalHintBindingsResponse', () => {
	it('parses LLM bindings for German hints to candidate ids', () => {
		const bindings = parseTemporalHintBindingsResponse(
			JSON.stringify({
				bindings: [
					{ hint: 'Fahrrad', eventId: 'ev-bike', thoughtId: 't-bike' },
					{ hint: 'Auto', eventId: 'ev-car', thoughtId: 't-car' }
				]
			}),
			['Fahrrad', 'Auto'],
			candidates
		);
		expect(bindings).toEqual([
			{ hint: 'Fahrrad', eventId: 'ev-bike', thoughtId: 't-bike' },
			{ hint: 'Auto', eventId: 'ev-car', thoughtId: 't-car' }
		]);
	});

	it('accepts a bare bindings array when the model omits the wrapper object', () => {
		const bindings = parseTemporalHintBindingsResponse(
			JSON.stringify([
				{ hint: 'Fahrrad', eventId: 'ev-bike', thoughtId: 't-bike' },
				{ hint: 'Auto', eventId: 'ev-car', thoughtId: 't-car' }
			]),
			['Fahrrad', 'Auto'],
			candidates
		);
		expect(bindings).toHaveLength(2);
	});

	it('allows null when no candidate matches a hint', () => {
		const bindings = parseTemporalHintBindingsResponse(
			JSON.stringify({
				bindings: [
					{ hint: 'Fahrrad', eventId: 'ev-bike', thoughtId: 't-bike' },
					null
				]
			}),
			['Fahrrad', 'Scooter'],
			candidates
		);
		expect(bindings).toHaveLength(1);
	});

	it('rejects bindings that reference unknown candidates', () => {
		expect(() =>
			parseTemporalHintBindingsResponse(
				JSON.stringify({
					bindings: [{ hint: 'Fahrrad', eventId: 'ev-missing', thoughtId: 't-missing' }]
				}),
				['Fahrrad'],
				candidates
			)
		).toThrow(/unknown candidate/);
	});

	it('accepts extra null slots when only one hint was requested (per-hint binding)', () => {
		const bindings = parseTemporalHintBindingsResponse(
			JSON.stringify({ bindings: [null, null, null] }),
			['Walk for Hunger'],
			candidates
		);
		expect(bindings).toEqual([]);
	});

	it('recovers a valid binding from a later slot when only one hint was requested', () => {
		const bindings = parseTemporalHintBindingsResponse(
			JSON.stringify({
				bindings: [
					null,
					{ hint: 'Walk for Hunger', eventId: 'ev-bike', thoughtId: 't-bike' },
					null
				]
			}),
			['Walk for Hunger'],
			candidates
		);
		expect(bindings).toEqual([
			{ hint: 'Walk for Hunger', eventId: 'ev-bike', thoughtId: 't-bike' }
		]);
	});

	it('truncates extra bindings when batch hint count is smaller', () => {
		const bindings = parseTemporalHintBindingsResponse(
			JSON.stringify({
				bindings: [
					{ hint: 'Fahrrad', eventId: 'ev-bike', thoughtId: 't-bike' },
					{ hint: 'Auto', eventId: 'ev-car', thoughtId: 't-car' },
					null
				]
			}),
			['Fahrrad', 'Auto'],
			candidates
		);
		expect(bindings).toHaveLength(2);
	});
});

describe('pruneTemporalBindingCandidates', () => {
	it('keeps milestone over inferred_event for the same thoughtId', () => {
		const pruned = pruneTemporalBindingCandidates([
			{
				eventId: 'ev-preorder',
				thoughtId: 't-dell',
				semanticSummary: 'Pre-ordered Dell XPS 13 laptop',
				startAt: '2023-01-28T00:00:00.000Z',
				kind: 'inferred_event'
			},
			{
				eventId: 'ev-arrival',
				thoughtId: 't-dell',
				semanticSummary: 'Dell XPS 13 laptop arrived',
				startAt: '2023-02-25T00:00:00.000Z',
				kind: 'milestone'
			},
			{
				eventId: 'ev-samsung',
				thoughtId: 't-samsung',
				semanticSummary: 'Purchased Samsung Galaxy S22',
				startAt: '2023-02-20T00:00:00.000Z',
				kind: 'milestone'
			}
		]);
		expect(pruned).toHaveLength(2);
		expect(pruned.map((c) => c.eventId).sort()).toEqual(['ev-arrival', 'ev-samsung']);
	});

	it('preserves distinct thoughtIds unchanged', () => {
		const pruned = pruneTemporalBindingCandidates(candidates);
		expect(pruned).toHaveLength(2);
	});
});

describe('filterBindingCandidatesForKind', () => {
	it('drops inferred_event for ordering', () => {
		const filtered = filterBindingCandidatesForKind(
			[
				{
					eventId: 'ev-pre',
					thoughtId: 't-dell',
					semanticSummary: 'Pre-ordered Dell XPS 13',
					startAt: '2023-01-28T00:00:00.000Z',
					kind: 'inferred_event'
				},
				{
					eventId: 'ev-arr',
					thoughtId: 't-dell',
					semanticSummary: 'Dell XPS 13 arrived',
					startAt: '2023-02-25T00:00:00.000Z',
					kind: 'milestone'
				}
			],
			'ordering'
		);
		expect(filtered).toHaveLength(1);
		expect(filtered[0]?.kind).toBe('milestone');
	});

	it('drops deadline and reminder for lookback', () => {
		const filtered = filterBindingCandidatesForKind(
			[
				{
					eventId: 'ev-deadline',
					thoughtId: 't-air',
					semanticSummary: 'Airbnb booking deadline',
					startAt: '2023-02-27T00:00:00.000Z',
					kind: 'deadline'
				},
				{
					eventId: 'ev-book',
					thoughtId: 't-air',
					semanticSummary: 'Booked Airbnb in Haight-Ashbury',
					startAt: '2022-12-27T00:00:00.000Z',
					kind: 'milestone'
				}
			],
			'lookback'
		);
		expect(filtered).toHaveLength(1);
		expect(filtered[0]?.kind).toBe('milestone');
	});
});

describe('prepareBindingCandidates', () => {
	it('applies kind filter then per-thought prune', () => {
		const prepared = prepareBindingCandidates(
			[
				{
					eventId: 'ev-pre',
					thoughtId: 't1',
					semanticSummary: 'Pre-order',
					startAt: '2023-01-28T00:00:00.000Z',
					kind: 'inferred_event'
				},
				{
					eventId: 'ev-got',
					thoughtId: 't1',
					semanticSummary: 'Received device',
					startAt: '2023-02-25T00:00:00.000Z',
					kind: 'milestone'
				}
			],
			'ordering'
		);
		expect(prepared).toHaveLength(1);
		expect(prepared[0]?.eventId).toBe('ev-got');
	});
});
