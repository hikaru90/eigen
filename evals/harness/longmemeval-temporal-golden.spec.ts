import { describe, expect, it } from 'vitest';
import { mergeQuestionEntityHints } from '$lib/server/retrieval/query-entity-hints';
import type { TemporalHintBinding } from '$lib/server/retrieval/resolve-temporal-hint-bindings';
import {
	formatSolverAnswer,
	solveTemporalQuestion,
	type TemporalSolverResult
} from '$lib/server/qa/temporal-solver';
import type { TemporalEventSeed } from '$lib/server/retrieval/temporal';

function seed(
	thoughtId: string,
	summary: string,
	startAt: string,
	kind: 'milestone' | 'inferred_event' = 'milestone'
): TemporalEventSeed {
	const iso = `${startAt}T12:00:00.000Z`;
	return {
		eventId: `ev-${thoughtId}`,
		thoughtId,
		semanticSummary: summary,
		startAt: new Date(iso),
		activePeriod: `[${iso},${iso.replace('T12:', 'T23:')})`,
		kind
	};
}

function hintBindings(hints: string[], thoughtIds: string[]): TemporalHintBinding[] {
	return hints.map((hint, index) => ({
		hint,
		eventId: `ev-${thoughtIds[index]!}`,
		thoughtId: thoughtIds[index]!
	}));
}

type GoldenCase = {
	question: string;
	kind: 'ordering' | 'duration' | 'count' | 'lookback' | 'span';
	seeds: TemporalEventSeed[];
	classifierHints: string[];
	hintThoughtIds: string[];
	referenceTime?: Date;
	durationUnit?: 'days' | 'weeks' | 'months';
	assert: (result: TemporalSolverResult, answer: string | null) => void;
};

const GOLDEN: GoldenCase[] = [
	{
		question:
			"Which event did I attend first, the 'Effective Time Management' workshop or the 'Data Analysis using Python' webinar?",
		kind: 'ordering',
		classifierHints: ['Effective Time Management', 'Data Analysis using Python'],
		hintThoughtIds: ['workshop', 'webinar'],
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
		classifierHints: ['bike', 'car'],
		hintThoughtIds: ['bike', 'car'],
		seeds: [
			seed('bike', 'Bike repairs in mid-February', '2023-02-15'),
			seed('car', 'Car wash for Toyota Corolla on February 27th', '2023-02-27')
		],
		assert: (r) => {
			expect(r.ordering?.earliest.thoughtId).toBe('bike');
		}
	},
	{
		question:
			'Welches Fahrzeug habe ich im Februar zuerst gewartet, das Fahrrad oder das Auto?',
		kind: 'ordering',
		classifierHints: ['Fahrrad', 'Auto'],
		hintThoughtIds: ['bike', 'car'],
		seeds: [
			seed('bike', 'Fahrradreparatur Mitte Februar', '2023-02-15'),
			seed('car', 'Autowäsche für Toyota Corolla am 27. Februar', '2023-02-27')
		],
		assert: (r) => {
			expect(r.ordering?.earliest.thoughtId).toBe('bike');
		}
	},
	{
		question: 'Which device did I got first, the Samsung Galaxy S22 or the Dell XPS 13?',
		kind: 'ordering',
		classifierHints: ['Samsung Galaxy S22', 'Dell XPS 13'],
		hintThoughtIds: ['samsung', 'dell'],
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
		classifierHints: ['Effective Communication in the Workplace', 'team meeting'],
		hintThoughtIds: ['workshop', 'meeting'],
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
		classifierHints: ["St. Mary's Church", 'Ash Wednesday service at the cathedral'],
		hintThoughtIds: ['mass', 'ash'],
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
		classifierHints: ['starting to work with Rachel', 'find a house I loved'],
		hintThoughtIds: ['rachel', 'house'],
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
		classifierHints: ['tomatoes', 'marigolds'],
		hintThoughtIds: ['tomato', 'marigold'],
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
		classifierHints: ['Holi celebration', "St. Mary's Church"],
		hintThoughtIds: ['holi', 'mass'],
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
		classifierHints: ['Turbocharged Tuesdays', 'Rack Fest'],
		hintThoughtIds: ['tuesday', 'rack'],
		seeds: [
			seed('tuesday', 'Turbocharged Tuesdays event', '2023-06-14'),
			seed('rack', 'Rack Fest event', '2023-06-18')
		],
		assert: (r) => {
			expect(r.durationDays?.exclusive).toBe(4);
		}
	},
	{
		question: 'Which vehicle did I take care of first in February, the bike or the car?',
		kind: 'ordering',
		classifierHints: ['bike', 'car'],
		hintThoughtIds: ['bike', 'car'],
		seeds: [
			seed('bike', 'Bike repairs in mid-February due to gear issues', '2023-02-15'),
			seed('car', 'Car wash for Toyota Corolla on Monday, February 27th', '2023-02-27')
		],
		assert: (r) => {
			expect(r.ordering?.earliest.thoughtId).toBe('bike');
		}
	},
	{
		question: 'Which device did I got first, the Samsung Galaxy S22 or the Dell XPS 13?',
		kind: 'ordering',
		classifierHints: ['Samsung Galaxy S22', 'Dell XPS 13'],
		hintThoughtIds: ['samsung', 'dell'],
		seeds: [
			seed('preorder', 'User pre-ordered Dell XPS 13 laptop on January 28th', '2023-01-28', 'inferred_event'),
			seed('samsung', 'Got new Samsung Galaxy S22 from Best Buy on February 20th', '2023-02-20'),
			seed('dell', 'Dell XPS 13 laptop arrived on February 25th', '2023-02-25')
		],
		assert: (r, answer) => {
			expect(r.ordering?.earliest.thoughtId).toBe('samsung');
			expect(answer).toMatch(/samsung/i);
		}
	},
	{
		question:
			"How many days had passed between the 'Walk for Hunger' event and the 'Coastal Cleanup' event?",
		kind: 'duration',
		classifierHints: ['Walk for Hunger', 'Coastal Cleanup'],
		hintThoughtIds: ['walk', 'coastal'],
		seeds: [
			seed('walk', "Walk for Hunger charity 5K on February 21st", '2023-02-21'),
			seed('coastal', 'Coastal Cleanup charity event on March 7th', '2023-03-07'),
			seed('hawaii', "Hawaii's ban on sunscreens took effect", '2021-01-01')
		],
		assert: (r, answer) => {
			expect(r.durationDays?.exclusive).toBe(14);
			expect(answer).toContain('14 calendar days');
		}
	},
	{
		question: 'Which event happened first, the purchase of the coffee maker or the malfunction of the stand mixer?',
		kind: 'ordering',
		classifierHints: ['coffee maker', 'stand mixer'],
		hintThoughtIds: ['coffee', 'mixer'],
		seeds: [
			seed('mixer', 'Stand mixer broke down and went to repair shop last month', '2023-04-22'),
			seed('coffee', 'Bought coffee maker about three weeks ago', '2023-05-01')
		],
		assert: (r) => {
			expect(r.ordering?.earliest.thoughtId).toBe('mixer');
		}
	},
	{
		question: 'Which item did I purchase first, the dog bed for Max or the training pads for Luna?',
		kind: 'ordering',
		classifierHints: ['dog bed for Max', 'training pads for Luna'],
		hintThoughtIds: ['pads', 'bed'],
		seeds: [
			seed('pads', 'Acquired eco-friendly training pads from Chewy.com', '2023-04-20'),
			seed('bed', 'Acquisition of new Orthopedic Memory Foam dog bed for Max', '2023-04-29')
		],
		assert: (r) => {
			expect(r.ordering?.earliest.thoughtId).toBe('pads');
		}
	},
	{
		question: 'Which task did I complete first, fixing the fence or trimming the goats\' hooves?',
		kind: 'ordering',
		classifierHints: ['fixing the fence', "trimming the goats' hooves"],
		hintThoughtIds: ['fence', 'goat'],
		seeds: [
			seed('fence', 'Fixed broken fence on east side of property', '2023-05-01'),
			seed('goat', "The user trimmed the goat's hooves two weeks ago", '2023-05-08')
		],
		assert: (r) => {
			expect(r.ordering?.earliest.thoughtId).toBe('fence');
		}
	},
	{
		question: "How many charity events did I participate in before the 'Run for the Cure' event?",
		kind: 'count',
		classifierHints: ["Run for the Cure"],
		hintThoughtIds: ['run'],
		seeds: [
			seed('walk', "Walk for Hunger charity 5K on February 21st", '2023-02-21'),
			seed('coastal', 'Coastal Cleanup charity event on March 7th', '2023-03-07'),
			seed('dance', 'Dance for a Cause charity event on May 1st', '2023-05-01'),
			seed('golf', 'Charity golf tournament on July 17th', '2023-07-17'),
			seed('run', "Run for the Cure event on October 15th", '2023-10-15')
		],
		assert: (r) => {
			expect(r.count?.value).toBe(4);
		}
	},
	{
		question: 'How long have I been working before I started my current job at NovaTech?',
		kind: 'span',
		classifierHints: ['working professionally', 'NovaTech'],
		hintThoughtIds: ['career', 'nova'],
		seeds: [
			seed('career', 'Started working professionally', '2014-05-01'),
			seed('nova', 'Working at NovaTech for about 4 years and 3 months', '2019-02-01')
		],
		assert: (r, answer) => {
			expect(r.span?.years).toBe(4);
			expect(r.span?.months).toBe(9);
			expect(answer).toMatch(/4 year/);
		}
	},
	{
		question: "Which book did I finish reading first, 'The Hate U Give' or 'The Nightingale'?",
		kind: 'ordering',
		classifierHints: ['The Hate U Give', 'The Nightingale'],
		hintThoughtIds: ['hate', 'night'],
		seeds: [
			seed('hate', 'Finished The Hate U Give two weeks ago', '2023-05-08'),
			seed('night', 'Finished The Nightingale last weekend', '2023-05-20')
		],
		assert: (r) => {
			expect(r.ordering?.earliest.thoughtId).toBe('hate');
		}
	},
	{
		question: 'Which device did I set up first, the smart thermostat or the mesh network system?',
		kind: 'ordering',
		classifierHints: ['smart thermostat', 'mesh network system'],
		hintThoughtIds: ['thermo', 'mesh'],
		seeds: [
			seed('thermo', 'Set up smart thermostat a month ago', '2023-04-24'),
			seed('mesh', 'Upgraded home Wi-Fi router to mesh network system 3 weeks ago', '2023-05-03')
		],
		assert: (r) => {
			expect(r.ordering?.earliest.thoughtId).toBe('thermo');
		}
	},
	{
		question: 'How many months ago did I book the Airbnb in San Francisco?',
		kind: 'lookback',
		classifierHints: ['Airbnb in San Francisco'],
		hintThoughtIds: ['airbnb'],
		referenceTime: new Date('2023-05-27T01:55:00.000Z'),
		durationUnit: 'months',
		seeds: [seed('airbnb', 'Booked Airbnb in Haight-Ashbury for wedding', '2022-12-27')],
		assert: (r, answer) => {
			expect(r.lookback?.value).toBe(5);
			expect(answer).toMatch(/5 month/);
		}
	}
];

describe('LongMemEval temporal-reasoning golden (solver + merged hints)', () => {
		for (const [index, row] of GOLDEN.entries()) {
		it(`case ${index + 1}: ${row.question.slice(0, 60)}…`, () => {
			const entityHints = mergeQuestionEntityHints(row.classifierHints);
			if (row.kind === 'ordering' || row.kind === 'duration') {
				expect(entityHints.length).toBeGreaterThanOrEqual(2);
			}
			const result = solveTemporalQuestion({
				kind: row.kind,
				entityHints,
				hintBindings: hintBindings(entityHints, row.hintThoughtIds),
				seeds: row.seeds,
				referenceTime: row.referenceTime,
				durationUnit: row.durationUnit ?? null
			});
			expect(result.confidence).toBe('high');
			const answer = formatSolverAnswer(result);
			expect(answer).not.toBeNull();
			row.assert(result, answer);
		});
	}
});
