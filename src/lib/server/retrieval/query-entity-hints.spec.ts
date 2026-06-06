import { describe, expect, it } from 'vitest';
import {
	extractDurationEndpointHints,
	extractOrAlternativePair,
	extractQuotedPhrases,
	hasComparativeOrderingStructure,
	mergeQuestionEntityHints,
	shouldUseDeterministicSolverAnswer
} from './query-entity-hints';
import { solveTemporalQuestion } from '$lib/server/qa/temporal-solver';
import type { TemporalEventSeed } from '$lib/server/retrieval/temporal';

function seed(
	thoughtId: string,
	summary: string,
	startAt: string
): TemporalEventSeed {
	const iso = `${startAt}T12:00:00.000Z`;
	return {
		eventId: `ev-${thoughtId}`,
		thoughtId,
		semanticSummary: summary,
		startAt: new Date(iso),
		activePeriod: `[${iso},${iso.replace('T12:', 'T23:')})`
	};
}

describe('extractQuotedPhrases', () => {
	it('extracts workshop and webinar names', () => {
		const q =
			"Which event did I attend first, the 'Effective Time Management' workshop or the 'Data Analysis using Python' webinar?";
		expect(extractQuotedPhrases(q)).toEqual([
			'Effective Time Management',
			'Data Analysis using Python'
		]);
	});
});

describe('extractOrAlternativePair', () => {
	it('extracts tomatoes or marigolds', () => {
		expect(extractOrAlternativePair('Which seeds were started first, the tomatoes or the marigolds?')).toEqual(
			['the tomatoes', 'marigolds']
		);
	});
});

describe('extractDurationEndpointHints', () => {
	it('extracts Rachel and house loved endpoints', () => {
		const q =
			'How many days did it take for me to find a house I loved after starting to work with Rachel?';
		const hints = extractDurationEndpointHints(q);
		expect(hints).toContain('find a house I loved');
		expect(hints).toContain('starting to work with Rachel');
	});
});

describe('mergeQuestionEntityHints', () => {
	it('supplements classifier hints with quoted phrases', () => {
		const merged = mergeQuestionEntityHints([], "Which device did I got first, the Samsung or the Dell?");
		expect(merged.length).toBeGreaterThanOrEqual(2);
	});
});

describe('shouldUseDeterministicSolverAnswer', () => {
	it('blocks ordering bypass for fact-lookup questions without A-or-B structure', () => {
		const q = 'What was the first issue I had with my new car after its first service?';
		const solver = solveTemporalQuestion({
			kind: 'ordering',
			entityHints: ['first service', 'GPS system'],
			seeds: [
				seed('svc', 'Car first service', '2023-03-15'),
				seed('gps', 'GPS system issue', '2023-03-22')
			]
		});
		expect(hasComparativeOrderingStructure(q)).toBe(false);
		expect(
			shouldUseDeterministicSolverAnswer({
				intentKind: 'ordering',
				solverResult: solver,
				question: q
			})
		).toBe(false);
	});

	it('allows duration bypass when classifier kind matches', () => {
		const q =
			'How many days did it take for me to find a house I loved after starting to work with Rachel?';
		const hints = mergeQuestionEntityHints([], q);
		const solver = solveTemporalQuestion({
			kind: 'duration',
			entityHints: hints,
			seeds: [
				seed('rachel', 'Started working with Rachel', '2022-02-15'),
				seed('house', 'Saw a house they loved', '2022-03-01')
			]
		});
		expect(
			shouldUseDeterministicSolverAnswer({
				intentKind: 'duration',
				solverResult: solver,
				question: q
			})
		).toBe(true);
	});
});
