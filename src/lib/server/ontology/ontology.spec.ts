import { describe, expect, it } from 'vitest';
import {
	emptyOntologyProfile,
	baselineOntologyProfile,
	mergeOntologyProfileWithBaseline,
	parseOntologyProfileJson,
	ontologyKindsPromptBlock,
	ONTOLOGY_PROFILE_VERSION
} from './types';

describe('parseOntologyProfileJson', () => {
	it('returns empty profile for non-objects', () => {
		expect(parseOntologyProfileJson(null)).toEqual(emptyOntologyProfile());
		expect(parseOntologyProfileJson(3)).toEqual(emptyOntologyProfile());
	});

	it('returns empty when version is unknown', () => {
		expect(parseOntologyProfileJson({ version: 99, kindGuidance: { perception: 'x' } })).toEqual(
			emptyOntologyProfile()
		);
	});

	it('parses v2 kindGuidance and summary with length caps', () => {
		const long = 'a'.repeat(5000);
		const parsed = parseOntologyProfileJson({
			version: ONTOLOGY_PROFILE_VERSION,
			kindGuidance: { perception: long, memory: '  recall  ' },
			summary: 'b'.repeat(5000)
		});
		expect(parsed.kindGuidance?.perception?.length).toBe(2000);
		expect(parsed.kindGuidance?.memory).toBe('recall');
		expect(parsed.summary?.length).toBe(4000);
	});

	it('migrates v1 profiles to v2 keeping summary only', () => {
		const parsed = parseOntologyProfileJson({
			version: 1,
			categoryGuidance: { task: 'ignored' },
			summary: 'kept'
		});
		expect(parsed.version).toBe(ONTOLOGY_PROFILE_VERSION);
		expect(parsed.summary).toBe('kept');
		expect(parsed.kindGuidance).toBeUndefined();
	});
});

describe('baselineOntologyProfile', () => {
	it('defines a corpus summary', () => {
		const b = baselineOntologyProfile();
		expect(b.summary?.length).toBeGreaterThan(20);
		expect(b.version).toBe(ONTOLOGY_PROFILE_VERSION);
	});
});

describe('mergeOntologyProfileWithBaseline', () => {
	it('fills summary from baseline when stored is empty', () => {
		const m = mergeOntologyProfileWithBaseline(emptyOntologyProfile());
		expect(m.summary).toContain('ontology entity kinds');
	});

	it('keeps stored summary and kindGuidance', () => {
		const m = mergeOntologyProfileWithBaseline({
			version: ONTOLOGY_PROFILE_VERSION,
			kindGuidance: { perception: 'User note' },
			summary: 'Custom summary'
		});
		expect(m.kindGuidance?.perception).toBe('User note');
		expect(m.summary).toBe('Custom summary');
	});
});

describe('ontologyKindsPromptBlock', () => {
	it('includes summary and kind definitions', () => {
		const block = ontologyKindsPromptBlock(
			[
				{ key: 'perception', name: 'Perception', definition: 'Sensory intake' },
				{ key: 'memory', name: 'Memory', definition: 'Past experience' }
			],
			emptyOntologyProfile()
		);
		expect(block).toContain('perception');
		expect(block).toContain('memory');
		expect(block).toContain('Sensory intake');
	});

	it('includes labeling notes from profile', () => {
		const block = ontologyKindsPromptBlock(
			[{ key: 'perception', name: 'Perception', definition: 'Sensory intake' }],
			{
				version: ONTOLOGY_PROFILE_VERSION,
				kindGuidance: { perception: 'Prefer literal senses' }
			}
		);
		expect(block).toContain('[labeling note: Prefer literal senses]');
	});
});
