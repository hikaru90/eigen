import { describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock('$lib/server/db', () => ({ getDb: getDbMock }));

describe('activity page server', () => {
	it('redirects unauthenticated user', async () => {
		await expect(load({ locals: { user: null } } as never)).rejects.toMatchObject({ status: 302 });
	});
});
