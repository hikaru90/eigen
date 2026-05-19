import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

const { listThoughtsMentioningCanonicalEntityMock } = vi.hoisted(() => ({
	listThoughtsMentioningCanonicalEntityMock: vi.fn()
}));

vi.mock('$lib/server/memory/canonical-entity-admin', () => ({
	listThoughtsMentioningCanonicalEntity: listThoughtsMentioningCanonicalEntityMock
}));

describe('GET /api/entities/[entityId]/thoughts', () => {
	it('requires auth', async () => {
		await expect(
			GET({ locals: { user: null }, params: { entityId: 'e1' } } as never)
		).rejects.toMatchObject({ status: 401 });
	});

	it('returns thoughts linked via entity_resolution_log', async () => {
		listThoughtsMentioningCanonicalEntityMock.mockResolvedValue([
			{ id: 't1', rawText: 'hello', normalizedText: 'hello', category: 'memory', createdAt: new Date() }
		]);
		const res = await GET({
			locals: { user: { id: 'u1' } },
			params: { entityId: 'e1' }
		} as never);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.thoughts).toHaveLength(1);
		expect(listThoughtsMentioningCanonicalEntityMock).toHaveBeenCalledWith('u1', 'e1');
	});
});
