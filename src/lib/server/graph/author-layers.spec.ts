import { describe, expect, it, vi } from 'vitest';
import { authorLayerKeyFromThought } from '$lib/server/memory/authorship';
import { serializeAuthorLayerIndex } from '$lib/server/graph/author-layers';

vi.mock('$lib/server/db', () => ({
	getDb: vi.fn()
}));

describe('author-layers helpers', () => {
	it('authorLayerKeyFromThought maps api key agent to stable key', () => {
		expect(
			authorLayerKeyFromThought({
				author: 'agent',
				authorKeyId: '11111111-1111-4111-8111-111111111111',
				authorLabel: 'Cursor'
			})
		).toBe('apikey:11111111-1111-4111-8111-111111111111');
	});

	it('serializeAuthorLayerIndex sorts layer keys', () => {
		const index = new Map<string, Set<string>>([
			['e1', new Set(['apikey:a', 'user'])],
			['e2', new Set(['user'])]
		]);
		expect(serializeAuthorLayerIndex(index)).toEqual({
			e1: ['apikey:a', 'user'],
			e2: ['user']
		});
	});
});
