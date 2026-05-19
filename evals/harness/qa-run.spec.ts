import { describe, expect, it } from 'vitest';
import { expandQa, expandQaEntries } from './qa-run';
import type { EvalQaRecord } from '../../src/lib/eval/qa-store';

const sampleQa: EvalQaRecord = {
	id: 'qa_test',
	question: 'what should I avoid bringing to dinner with Marcus',
	acceptance: 'Must mention walnut allergy for Marcus.',
	captures: [
		{
			fixtureId: 'ec_011',
			rawText: 'Marcus is allergic to walnuts. Do not bring walnut bread to dinner.'
		}
	],
	retrievalQuery: null,
	retrievalRelevant: [],
	tags: [],
	edit: null,
	checks: {},
	createdAt: '',
	updatedAt: ''
};

const secondQa: EvalQaRecord = {
	id: 'qa_test_2',
	question: 'what flour does Marcus use',
	acceptance: 'Must mention rice flour.',
	captures: [
		{ fixtureId: 'ec_011', rawText: 'Marcus is allergic to walnuts.' },
		{ fixtureId: 'ec_006', rawText: 'Marcus uses rice flour in banneton.' }
	],
	retrievalQuery: null,
	retrievalRelevant: [],
	tags: [],
	edit: null,
	checks: {},
	createdAt: '',
	updatedAt: ''
};

const retrievalQa: EvalQaRecord = {
	...sampleQa,
	id: 'qa_retrieval',
	retrievalQuery: 'Marcus allergy',
	retrievalRelevant: [{ id: 'ec_011', grade: 3 }],
	tags: ['recall']
};

const editQa: EvalQaRecord = {
	...sampleQa,
	id: 'qa_edit',
	edit: { fixtureId: 'ec_011', newRawText: 'Marcus is allergic to pecans.' }
};

describe('expandQa', () => {
	it('orders captures, check, then answer', () => {
		const entries = expandQa(sampleQa);
		expect(entries.map((e) => e.kind)).toEqual(['capture', 'check', 'answer']);
	});

	it('includes acceptance on answer entry', () => {
		const answer = expandQa(sampleQa).find((e) => e.kind === 'answer');
		expect(answer?.expectedJson.acceptance).toBe(sampleQa.acceptance);
		expect(answer?.inputJson.question).toBe(sampleQa.question);
	});

	it('inserts retrieval after check when configured', () => {
		const kinds = expandQa(retrievalQa).map((e) => e.kind);
		expect(kinds).toEqual(['capture', 'check', 'retrieval', 'answer']);
	});

	it('inserts edit after check when configured', () => {
		const kinds = expandQa(editQa).map((e) => e.kind);
		expect(kinds).toEqual(['capture', 'check', 'edit', 'answer']);
	});

	it('passes retrieval thresholds from checks on retrieval entry', () => {
		const retrieval = expandQa({
			...retrievalQa,
			checks: { retrieval: { minNdcgAt10: 0.7, needleFixtureId: 'ec_011', needleTopK: 3 } }
		}).find((e) => e.kind === 'retrieval');
		expect(retrieval?.expectedJson.minNdcgAt10).toBe(0.7);
		expect(retrieval?.expectedJson.needleFixtureId).toBe('ec_011');
		expect(retrieval?.expectedJson.needleTopK).toBe(3);
	});
});

describe('expandQaEntries', () => {
	it('dedupes captures and runs all answers', () => {
		const entries = expandQaEntries([sampleQa, secondQa]);
		expect(entries.filter((e) => e.kind === 'capture')).toHaveLength(2);
		expect(entries.filter((e) => e.kind === 'answer')).toHaveLength(2);
		expect(entries.at(-1)?.fixtureRef).toBe('qa_test_2');
	});
});
