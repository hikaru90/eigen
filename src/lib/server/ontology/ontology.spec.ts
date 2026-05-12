import { describe, expect, it } from 'vitest';
import { LEGACY_CAPTURE_CATEGORY_KEYS } from '$lib/server/db/schema';
import {
	emptyOntologyProfile,
	baselineOntologyProfile,
	mergeOntologyProfileWithBaseline,
	isThoughtCategory,
	parseOntologyProfileJson,
	profileToPromptBlock
} from './types';

describe('isThoughtCategory', () => {
	it('accepts baseline categories', () => {
		expect(isThoughtCategory('task')).toBe(true);
		expect(isThoughtCategory('date')).toBe(true);
	});
	it('rejects unknown labels', () => {
		expect(isThoughtCategory('meeting')).toBe(false);
		expect(isThoughtCategory('')).toBe(false);
	});
});

describe('parseOntologyProfileJson', () => {
	it('returns empty profile for non-objects', () => {
		expect(parseOntologyProfileJson(null)).toEqual(emptyOntologyProfile());
		expect(parseOntologyProfileJson(3)).toEqual(emptyOntologyProfile());
	});

	it('returns empty when version mismatches', () => {
		expect(parseOntologyProfileJson({ version: 2, categoryGuidance: { task: 'x' } })).toEqual(
			emptyOntologyProfile()
		);
	});

	it('parses guidance and summary with length caps', () => {
		const long = 'a'.repeat(5000);
		const parsed = parseOntologyProfileJson({
			version: 1,
			categoryGuidance: { task: long, idea: '  brainstorm  ' },
			summary: 'b'.repeat(5000)
		});
		expect(parsed.categoryGuidance.task?.length).toBe(2000);
		expect(parsed.categoryGuidance.idea).toBe('brainstorm');
		expect(parsed.summary?.length).toBe(4000);
	});

	it('ignores invalid category keys in guidance object', () => {
		const parsed = parseOntologyProfileJson({
			version: 1,
			categoryGuidance: { task: 'ok', meeting: 'ignored' }
		});
		expect(parsed.categoryGuidance.task).toBe('ok');
		expect('meeting' in parsed.categoryGuidance).toBe(false);
	});
});

describe('baselineOntologyProfile', () => {
	it('defines all six categories', () => {
		const b = baselineOntologyProfile();
		for (const cat of LEGACY_CAPTURE_CATEGORY_KEYS) {
			expect(b.categoryGuidance[cat]?.length).toBeGreaterThan(20);
		}
		expect(b.summary?.length).toBeGreaterThan(10);
	});
});

describe('mergeOntologyProfileWithBaseline', () => {
	it('fills empty stored profile from baseline', () => {
		const m = mergeOntologyProfileWithBaseline(emptyOntologyProfile());
		expect(m.categoryGuidance.thought).toContain('General notes');
		expect(m.summary).toContain('Default ontology');
	});

	it('lets stored guidance override baseline per key', () => {
		const m = mergeOntologyProfileWithBaseline({
			version: 1,
			categoryGuidance: { task: 'User uses REM' },
			summary: 'Custom summary'
		});
		expect(m.categoryGuidance.task).toBe('User uses REM');
		expect(m.categoryGuidance.idea).toContain('Creative');
		expect(m.summary).toBe('Custom summary');
	});
});

describe('profileToPromptBlock', () => {
	it('includes baseline when stored profile is empty', () => {
		const block = profileToPromptBlock(emptyOntologyProfile());
		expect(block).toContain('Corpus summary:');
		expect(block).toContain('thought:');
		expect(block).toContain('task:');
		expect(block).toContain('person:');
	});

	it('renders stored summary and overrides alongside baseline-filled keys', () => {
		const block = profileToPromptBlock({
			version: 1,
			categoryGuidance: { task: 'Uses REM for tasks' },
			summary: 'Mostly tasks'
		});
		expect(block).toContain('Corpus summary: Mostly tasks');
		expect(block).toContain('task: Uses REM for tasks');
		expect(block).toContain('idea:');
	});
});
