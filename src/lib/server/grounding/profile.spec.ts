import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateGroundingFacetInput } from '$lib/server/grounding/profile';

describe('validateGroundingFacetInput', () => {
	it('accepts canonical facet keys', () => {
		const result = validateGroundingFacetInput([
			{ key: 'work', content: 'Software engineer' },
			{ key: 'values', content: 'Family first' }
		]);
		expect(result).toHaveLength(2);
		expect(result[0].key).toBe('work');
	});

	it('rejects unknown facet keys', () => {
		expect(() =>
			validateGroundingFacetInput([{ key: 'hobbies', content: 'Running' }])
		).toThrow(/Invalid grounding facet key/);
	});

	it('rejects empty content', () => {
		expect(() => validateGroundingFacetInput([{ key: 'work', content: '   ' }])).toThrow(
			/cannot be empty/
		);
	});
});
