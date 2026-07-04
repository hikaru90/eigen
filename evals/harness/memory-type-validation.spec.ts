import { describe, expect, it } from 'vitest';
import {
	isPersistedMemoryTypeValid,
	isThoughtCategoryKeyConfusion,
	normalizeMemoryType
} from '$lib/server/memory/memory-type-catalog';

describe('eval memoryType validation', () => {
	it('rejects category-only keys that block ingest when copied into memoryType', () => {
		expect(isThoughtCategoryKeyConfusion('observation')).toBe(true);
		expect(normalizeMemoryType('observation')).toBeNull();
		expect(isPersistedMemoryTypeValid('observation')).toBe(false);
	});

	it('accepts canonical memoryType keys for persisted rows', () => {
		for (const key of ['episode', 'fact', 'decision', 'concern', 'preference', 'pattern'] as const) {
			expect(isPersistedMemoryTypeValid(key)).toBe(true);
		}
	});

	it('treats decision as valid memoryType even though it is also a category key', () => {
		expect(isThoughtCategoryKeyConfusion('decision')).toBe(false);
		expect(isPersistedMemoryTypeValid('decision')).toBe(true);
	});
});
