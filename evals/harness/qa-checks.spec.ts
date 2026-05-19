import { describe, expect, it } from 'vitest';
import { defaultChecksForQa, normalizeChecks, resolveChecks } from './qa-checks';
import type { EvalQaRecord } from '../../src/lib/eval/qa-store';

const baseQa: EvalQaRecord = {
	id: 'qa_test',
	question: 'test',
	acceptance: 'test',
	captures: [{ fixtureId: 'ec_011', rawText: 'Marcus allergy' }],
	retrievalQuery: null,
	retrievalRelevant: [],
	tags: [],
	edit: null,
	checks: {},
	createdAt: '',
	updatedAt: ''
};

describe('normalizeChecks', () => {
	it('returns empty object for invalid input', () => {
		expect(normalizeChecks(null)).toEqual({});
		expect(normalizeChecks('x')).toEqual({});
	});

	it('passes through object checks', () => {
		const checks = { graph: { requireThoughtNodes: ['ec_011'] } };
		expect(normalizeChecks(checks)).toEqual(checks);
	});
});

describe('defaultChecksForQa', () => {
	it('includes graph, embedding, ontology, extraction for captures', () => {
		const checks = defaultChecksForQa(baseQa);
		expect(checks.graph?.requireThoughtNodes).toEqual(['ec_011']);
		expect(checks.embedding?.requireVector).toEqual(['ec_011']);
		expect(checks.ontology?.requireActiveCategories).toEqual(['ec_011']);
		expect(checks.extraction?.requireEnriched).toEqual(['ec_011']);
	});
});

describe('resolveChecks', () => {
	it('uses explicit checks when configured', () => {
		const qa: EvalQaRecord = {
			...baseQa,
			checks: { graph: { requireThoughtNodes: ['ec_006'] } }
		};
		expect(resolveChecks(qa).graph?.requireThoughtNodes).toEqual(['ec_006']);
	});

	it('falls back to defaults when checks empty', () => {
		expect(resolveChecks(baseQa).graph?.requireThoughtNodes).toEqual(['ec_011']);
	});
});
