import { describe, expect, it } from 'vitest';
import {
	assignCaptureFixtureIds,
	generateEvalQaId,
	generateFixtureId,
	slugifyQuestionForQaId,
	validateEvalQaId
} from './qa-id';

describe('qa-id', () => {
	it('slugifies question text', () => {
		expect(slugifyQuestionForQaId('What should I avoid for Marcus dinner?')).toBe(
			'what_should_i_avoid_for_marcus_dinner'
		);
	});

	it('generates qa_ prefixed id', () => {
		const id = generateEvalQaId('Marcus walnut allergy', new Set());
		expect(id).toBe('qa_marcus_walnut_allergy');
		expect(validateEvalQaId(id)).toBe(id);
	});

	it('dedupes collisions with numeric suffix', () => {
		const existing = new Set(['qa_marcus_walnut_allergy']);
		expect(generateEvalQaId('Marcus walnut allergy', existing)).toBe('qa_marcus_walnut_allergy_2');
	});

	it('generates fixture ids from thought text', () => {
		expect(generateFixtureId('Marcus is allergic to walnuts', new Set())).toBe(
			'ec_marcus_is_allergic_to_walnuts'
		);
	});

	it('assigns fixture ids when missing', () => {
		const assigned = assignCaptureFixtureIds(
			[{ fixtureId: '', rawText: 'Hello world' }],
			new Set(['ec_hello_world'])
		);
		expect(assigned[0]!.fixtureId).toBe('ec_hello_world_2');
	});
});
