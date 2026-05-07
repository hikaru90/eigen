import { describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

const { getDbMock, authDbMock } = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	authDbMock: {
		select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => []) })) })) })),
		update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) }))
	}
}));
vi.mock('$lib/server/db', () => ({ getDb: getDbMock }));
vi.mock('$lib/server/db/auth-db', () => ({ authDb: authDbMock }));

describe('capture page server', () => {
	it('redirects unauthenticated load', async () => {
		await expect(load({ locals: { user: null } } as never)).rejects.toMatchObject({ status: 302 });
	});
	it('completeOnboarding requires auth', async () => {
		const result = await actions.completeOnboarding({ locals: { user: null } } as never);
		expect(result).toMatchObject({ status: 401 });
	});
});
