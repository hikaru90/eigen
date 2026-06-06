import { describe, expect, it } from 'vitest';
import { mergeQuestionEntityHints } from '$lib/server/retrieval/query-entity-hints';
import {
	formatSolverAnswer,
	solveTemporalQuestion,
	type TemporalSolverResult
} from '$lib/server/qa/temporal-solver';
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

type GoldenCase = {
	question: string;
	kind: 'ordering' | 'duration';
	seeds: TemporalEventSeed[];
	classifierHints: string[];
	assert: (result: TemporalSolverResult, answer: string | null) => void;
};

const GOLDEN: GoldenCase[] = [
	{
		question:
			"Which event did I attend first, the 'Effective Time Management' workshop or the 'Data Analysis using Python' webinar?",
		kind: 'ordering',
		classifierHints: [],
		seeds: [
			seed('webinar', 'Data Analysis using Python webinar', '2023-03-28'),
			seed('workshop', 'Effective Time Management workshop', '2023-05-27')
		],
		assert: (r, answer) => {
			expect(r.ordering?.earliest.thoughtId).toBe('webinar');
			expect(answer).toMatch(/data analysis using python/i);
		}
	},
	{
		question: 'Which vehicle did I take care of first in February, the bike or the car?',
		kind: 'ordering',
		classifierHints: [],
		seeds: [
			seed('bike', 'Bike repairs in mid-February', '2023-02-15'),
			seed('car', 'Car washed on February 27th', '2023-02-27')
		],
		assert: (r) => {
			expect(r.ordering?.earliest.thoughtId).toBe('bike');
		}
	},
	{
		question: 'Which device did I got first, the Samsung Galaxy S22 or the Dell XPS 13?',
		kind: 'ordering',
		classifierHints: [],
		seeds: [
			seed('samsung', 'Purchased Samsung Galaxy S22', '2023-02-20'),
			seed('dell', 'Dell XPS 13 laptop arrived', '2023-02-25')
		],
		assert: (r) => {
			expect(r.ordering?.earliest.thoughtId).toBe('samsung');
		}
	},
	{
		question:
			"How many days before the team meeting I was preparing for did I attend the workshop on 'Effective Communication in the Workplace'?",
		kind: 'duration',
		classifierHints: [],
		seeds: [
			seed('workshop', 'Effective Communication in the Workplace workshop', '2023-01-10'),
			seed('meeting', 'Team meeting on January 17th', '2023-01-17')
		],
		assert: (r, answer) => {
			expect(r.durationDays?.exclusive).toBe(7);
			expect(answer).toContain('7 calendar days');
		}
	},
	{
		question:
			"How many days had passed between the Sunday mass at St. Mary's Church and the Ash Wednesday service at the cathedral?",
		kind: 'duration',
		classifierHints: [],
		seeds: [
			seed('mass', "Sunday mass at St. Mary's Church", '2023-01-02'),
			seed('ash', 'Ash Wednesday service at cathedral', '2023-02-01')
		],
		assert: (r) => {
			expect(r.durationDays?.exclusive).toBe(30);
		}
	},
	{
		question:
			'How many days did it take for me to find a house I loved after starting to work with Rachel?',
		kind: 'duration',
		classifierHints: [],
		seeds: [
			seed('rachel', 'Started working with Rachel on February 15th', '2022-02-15'),
			seed('house', 'Saw a house they loved on March 1st', '2022-03-01'),
			seed('mortgage', 'Pre-approved for mortgage on February 10th', '2022-02-10'),
			seed('offer', 'Submit offer on March 2nd', '2022-03-02')
		],
		assert: (r, answer) => {
			expect(r.durationDays?.exclusive).toBe(14);
			expect(answer).toContain('14 calendar days');
		}
	},
	{
		question: 'Which seeds were started first, the tomatoes or the marigolds?',
		kind: 'ordering',
		classifierHints: [],
		seeds: [
			seed('tomato', 'Starting tomato seeds since February 20th', '2023-02-20'),
			seed('marigold', 'Marigold seeds started on March 3rd', '2023-03-03')
		],
		assert: (r, answer) => {
			expect(r.ordering?.earliest.thoughtId).toBe('tomato');
			expect(answer).toMatch(/tomato/i);
		}
	},
	{
		question:
			"How many days had passed between the Hindu festival of Holi and the Sunday mass at St. Mary's Church?",
		kind: 'duration',
		classifierHints: [],
		seeds: [
			seed('holi', 'Holi celebration at local temple', '2023-02-26'),
			seed('mass', "Sunday mass at St. Mary's Church", '2023-03-19')
		],
		assert: (r) => {
			expect(r.durationDays?.exclusive).toBe(21);
		}
	},
	{
		question:
			"How many days before the 'Rack Fest' did I participate in the 'Turbocharged Tuesdays' event?",
		kind: 'duration',
		classifierHints: [],
		seeds: [
			seed('tuesday', 'Turbocharged Tuesdays event', '2023-06-14'),
			seed('rack', 'Rack Fest event', '2023-06-18')
		],
		assert: (r) => {
			expect(r.durationDays?.exclusive).toBe(4);
		}
	}
];

describe('LongMemEval temporal-reasoning golden (solver + merged hints)', () => {
	for (const [index, row] of GOLDEN.entries()) {
		it(`case ${index + 1}: ${row.question.slice(0, 60)}…`, () => {
			const entityHints = mergeQuestionEntityHints(row.classifierHints, row.question);
			expect(entityHints.length).toBeGreaterThanOrEqual(2);
			const result = solveTemporalQuestion({
				kind: row.kind,
				entityHints,
				seeds: row.seeds
			});
			expect(result.confidence).toBe('high');
			const answer = formatSolverAnswer(result);
			expect(answer).not.toBeNull();
			row.assert(result, answer);
		});
	}
});
