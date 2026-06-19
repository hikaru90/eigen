import { describe, expect, it } from 'vitest';
import { groundingProfilePromptBlock } from '$lib/server/grounding/prompt-block';

describe('groundingProfilePromptBlock', () => {
	it('returns empty string when profile is null', () => {
		expect(groundingProfilePromptBlock(null)).toBe('');
	});

	it('includes narrative and facets', () => {
		const block = groundingProfilePromptBlock({
			narrativeSummary: 'You are a parent who values deep work.',
			facets: { work: 'Software engineer', values: 'Family first' }
		});
		expect(block).toContain('supplementary background');
		expect(block).toContain('deep work');
		expect(block).toContain('work: Software engineer');
	});
});
