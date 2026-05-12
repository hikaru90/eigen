import { describe, expect, it, vi } from 'vitest';
import { DELETE, GET, PATCH } from './+server';

const {
	getCanonicalEntityForUserMock,
	updateCanonicalEntityForUserMock,
	deleteCanonicalEntityForUserMock
} = vi.hoisted(() => ({
	getCanonicalEntityForUserMock: vi.fn(),
	updateCanonicalEntityForUserMock: vi.fn(),
	deleteCanonicalEntityForUserMock: vi.fn()
}));

vi.mock('$lib/server/memory/canonical-entity-admin', () => ({
	getCanonicalEntityForUser: getCanonicalEntityForUserMock,
	updateCanonicalEntityForUser: updateCanonicalEntityForUserMock,
	deleteCanonicalEntityForUser: deleteCanonicalEntityForUserMock
}));

describe('GET /api/entities/[entityId]', () => {
	it('requires auth', async () => {
		await expect(
			GET({ locals: { user: null }, params: { entityId: 'e1' } } as never)
		).rejects.toMatchObject({ status: 401 });
	});

	it('returns entity row', async () => {
		getCanonicalEntityForUserMock.mockResolvedValue({
			id: 'e1',
			label: 'Sam',
			entityType: 'person',
			canonicalKey: 'sam'
		});
		const res = await GET({
			locals: { user: { id: 'u1' } },
			params: { entityId: 'e1' }
		} as never);
		expect(res.status).toBe(200);
	});
});

describe('PATCH /api/entities/[entityId]', () => {
	it('requires auth', async () => {
		await expect(
			PATCH({
				locals: { user: null },
				params: { entityId: 'e1' },
				request: new Request('http://x', { method: 'PATCH', body: '{}', headers: { 'content-type': 'application/json' } })
			} as never)
		).rejects.toMatchObject({ status: 401 });
	});

	it('returns 400 when body has no patch fields', async () => {
		await expect(
			PATCH({
				locals: { user: { id: 'u1' } },
				params: { entityId: 'e1' },
				request: new Request('http://x', { method: 'PATCH', body: '{}', headers: { 'content-type': 'application/json' } })
			} as never)
		).rejects.toMatchObject({ status: 400 });
	});

	it('returns entity after update', async () => {
		updateCanonicalEntityForUserMock.mockResolvedValue({
			ok: true,
			entity: { id: 'e1', label: 'Sam2', entityType: 'person', canonicalKey: 'sam' }
		});
		const res = await PATCH({
			locals: { user: { id: 'u1' } },
			params: { entityId: 'e1' },
			request: new Request('http://x', {
				method: 'PATCH',
				body: JSON.stringify({ label: 'Sam2' }),
				headers: { 'content-type': 'application/json' }
			})
		} as never);
		expect(res.status).toBe(200);
	});
});

describe('DELETE /api/entities/[entityId]', () => {
	it('requires auth', async () => {
		await expect(
			DELETE({ locals: { user: null }, params: { entityId: 'e1' } } as never)
		).rejects.toMatchObject({ status: 401 });
	});

	it('returns 404 when entity missing', async () => {
		deleteCanonicalEntityForUserMock.mockResolvedValue({ ok: false, reason: 'not_found' });
		await expect(
			DELETE({ locals: { user: { id: 'u1' } }, params: { entityId: 'e1' } } as never)
		).rejects.toMatchObject({ status: 404 });
	});

	it('returns ok when deleted', async () => {
		deleteCanonicalEntityForUserMock.mockResolvedValue({ ok: true });
		const res = await DELETE({
			locals: { user: { id: 'u1' } },
			params: { entityId: 'e1' }
		} as never);
		expect(res.status).toBe(200);
		expect(deleteCanonicalEntityForUserMock).toHaveBeenCalledWith('u1', 'e1');
	});
});
