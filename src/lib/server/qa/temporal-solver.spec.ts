import { describe, expect, it } from 'vitest';
import {
	allowsComputedTimelineCitation,
	COMPUTED_TIMELINE_CITATION_ID,
	calendarDaysBetweenExclusive,
	calendarDaysBetweenInclusive,
	eventMatchesEntityHint,
	formatComputedTimelineForPrompt,
	formatSolverAnswer,
	scoreEntityHintMatch,
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

	it('webinar before Effective Time Management workshop', () => {
		const result = solveTemporalQuestion({
			kind: 'ordering',
			entityHints: ['Effective Time Management', 'Data Analysis using Python'],
			seeds: [
				seed('webinar', 'Participated in Data Analysis using Python webinar', '2023-03-28'),
				seed('workshop', 'Workshop on Effective Time Management at community center', '2023-05-27')
			]
		});
		expect(result.ordering?.earliest.thoughtId).toBe('webinar');
		expect(result.ordering?.latest.thoughtId).toBe('workshop');
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

	it('prefers stronger matches for Rachel vs mortgage pre-approval', () => {
		const rachel = scoreEntityHintMatch('Started working with Rachel on February 15th', 'Rachel');
		const mortgage = scoreEntityHintMatch(
			'User got pre-approved for a mortgage on February 10th',
			'Rachel'
		);
		expect(rachel).toBeGreaterThan(mortgage);
	});
});

describe('formatSolverAnswer', () => {
	it('emits deterministic ordering answer', () => {
		const result = solveTemporalQuestion({
			kind: 'ordering',
			entityHints: ['tomatoes', 'marigolds'],
			seeds: [
				seed('f859cd45', 'Starting tomato seeds indoors since February 20th', '2023-02-20'),
				seed('7a92186a', 'Marigold seeds arrived and began germinating', '2023-03-03')
			]
		});
		const answer = formatSolverAnswer(result);
		expect(answer).toMatch(/tomato.*came first/i);
		expect(answer).toContain('[id=computed]');
		expect(answer).toContain('f859cd45');
	});

	it('emits deterministic duration answer', () => {
		const result = solveTemporalQuestion({
			kind: 'duration',
			entityHints: ['Rachel', 'house they loved'],
			seeds: [
				seed('5edd1f50', 'Started working with Rachel', '2022-02-15'),
				seed('2a2b2686', 'Saw a house they loved', '2022-03-01'),
				seed('mortgage', 'User got pre-approved for a mortgage', '2022-02-10'),
				seed('offer', 'User will submit the offer today', '2022-03-02')
			]
		});
		const answer = formatSolverAnswer(result);
		expect(answer).toContain('14 calendar days');
		expect(answer).toContain('Rachel');
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

describe('formatComputedTimelineForPrompt', () => {
	it('documents the computed citation token for high-confidence results', () => {
		const result = solveTemporalQuestion({
			kind: 'duration',
			entityHints: ['Effective Communication in the Workplace', 'team meeting'],
			seeds: [
				seed('b84f3fdc', 'Workshop on Effective Communication in the Workplace', '2023-01-10'),
				seed('96797297', 'Team meeting scheduled', '2023-01-17')
			]
		});
		expect(allowsComputedTimelineCitation(result)).toBe(true);
		const block = formatComputedTimelineForPrompt(result);
		expect(block).toContain(`[id=${COMPUTED_TIMELINE_CITATION_ID}]`);
		expect(block).toContain('7 calendar days');
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

	it('does not fall back to unrelated events when fewer than two hints match', () => {
		const result = solveTemporalQuestion({
			kind: 'duration',
			entityHints: ['Rachel', 'house they loved'],
			seeds: [
				seed('mortgage', 'User got pre-approved for a mortgage', '2022-02-10'),
				seed('offer', 'User will submit the offer today', '2022-03-02')
			]
		});
		expect(result.confidence).toBe('low');
		expect(result.kind).toBe('unsupported');
	});
});
