import { describe, expect, it } from 'vitest';
import {
	calendarDaysBetweenExclusive,
	calendarDaysBetweenInclusive,
	eventMatchesEntityHint,
	seedsToTimelineEvents,
	solveTemporalQuestion,
	type TemporalSolverResult
} from './temporal-solver';
import type { TemporalEventSeed } from '$lib/server/retrieval/temporal';

function seed(
	thoughtId: string,
	summary: string,
	startAt: string,
	activePeriod?: string
): TemporalEventSeed {
	const iso = `${startAt}T00:00:00.000Z`;
	return {
		eventId: `ev-${thoughtId}`,
		thoughtId,
		semanticSummary: summary,
		startAt: new Date(iso),
		activePeriod: activePeriod ?? `[${iso},${iso.replace('T00:', 'T23:')})`
	};
}

describe('calendarDaysBetweenExclusive', () => {
	it('Jan 10 → Jan 17 = 7 days', () => {
		expect(
			calendarDaysBetweenExclusive(new Date('2023-01-10T00:00:00.000Z'), new Date('2023-01-17T00:00:00.000Z'))
		).toBe(7);
	});

	it('Feb 15 → Mar 1 = 14 exclusive / 15 inclusive', () => {
		const from = new Date('2022-02-15T00:00:00.000Z');
		const to = new Date('2022-03-01T00:00:00.000Z');
		expect(calendarDaysBetweenExclusive(from, to)).toBe(14);
		expect(calendarDaysBetweenInclusive(from, to)).toBe(15);
	});

	it('Jan 2 → Feb 1 = 30 exclusive', () => {
		expect(
			calendarDaysBetweenExclusive(new Date('2023-01-02T00:00:00.000Z'), new Date('2023-02-01T00:00:00.000Z'))
		).toBe(30);
	});

	it('Jun 14 → Jun 18 = 4 days', () => {
		expect(
			calendarDaysBetweenExclusive(new Date('2023-06-14T00:00:00.000Z'), new Date('2023-06-18T00:00:00.000Z'))
		).toBe(4);
	});
});

describe('solveTemporalQuestion ordering', () => {
	it('Dell XPS 13 before Samsung Galaxy S22', () => {
		const result = solveTemporalQuestion({
			kind: 'ordering',
			entityHints: ['Samsung Galaxy S22', 'Dell XPS 13'],
			seeds: [
				seed('251d4e4e', 'User pre-ordered Dell XPS 13 laptop', '2023-01-28'),
				seed('6e22a9db', 'User purchased Samsung Galaxy S22', '2023-02-20')
			]
		});
		expect(result.confidence).toBe('high');
		expect(result.ordering?.earliest.thoughtId).toBe('251d4e4e');
		expect(result.ordering?.latest.thoughtId).toBe('6e22a9db');
	});

	it('tomatoes before marigolds', () => {
		const result = solveTemporalQuestion({
			kind: 'ordering',
			entityHints: ['tomatoes', 'marigolds'],
			seeds: [
				seed('f859cd45', 'Starting tomato seeds indoors since February 20th', '2023-02-20'),
				seed('7a92186a', 'Marigold seeds arrived and began germinating', '2023-03-03')
			]
		});
		expect(result.ordering?.earliest.thoughtId).toBe('f859cd45');
		expect(result.ordering?.latest.thoughtId).toBe('7a92186a');
	});
});

describe('solveTemporalQuestion duration', () => {
	it('workshop to team meeting = 7 days', () => {
		const result = solveTemporalQuestion({
			kind: 'duration',
			entityHints: ['Effective Communication in the Workplace', 'team meeting'],
			seeds: [
				seed('b84f3fdc', 'Workshop on Effective Communication in the Workplace', '2023-01-10'),
				seed('96797297', 'Team meeting scheduled', '2023-01-17')
			]
		});
		expect(result.kind).toBe('duration');
		expect(result.durationDays?.exclusive).toBe(7);
	});

	it('Rachel start to house loved = 14 exclusive', () => {
		const result = solveTemporalQuestion({
			kind: 'duration',
			entityHints: ['Rachel', 'house they loved'],
			seeds: [
				seed('5edd1f50', 'Started working with Rachel', '2022-02-15'),
				seed('2a2b2686', 'Saw a house they loved', '2022-03-01')
			]
		});
		expect(result.durationDays?.exclusive).toBe(14);
		expect(result.durationDays?.inclusive).toBe(15);
	});
});

describe('eventMatchesEntityHint', () => {
	it('matches classifier hints to summaries', () => {
		expect(eventMatchesEntityHint('User purchased Samsung Galaxy S22', 'Samsung Galaxy S22')).toBe(true);
		expect(eventMatchesEntityHint('Marigold seeds arrived', 'marigolds')).toBe(true);
	});
});

describe('seedsToTimelineEvents', () => {
	it('sorts chronologically', () => {
		const events = seedsToTimelineEvents([
			seed('b', 'later', '2023-03-01'),
			seed('a', 'earlier', '2023-01-01')
		]);
		expect(events.map((e) => e.thoughtId)).toEqual(['a', 'b']);
	});
});

describe('low confidence fallthrough', () => {
	it('returns unsupported when only one event', () => {
		const result: TemporalSolverResult = solveTemporalQuestion({
			kind: 'duration',
			entityHints: ['a', 'b'],
			seeds: [seed('only', 'single event', '2023-01-01')]
		});
		expect(result.confidence).toBe('low');
		expect(result.kind).toBe('unsupported');
	});
});
