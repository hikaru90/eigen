import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authDbMock } = vi.hoisted(() => ({
	authDbMock: {
		select: vi.fn(),
		update: vi.fn()
	}
}));

vi.mock('$lib/server/db/auth-db', () => ({ authDb: authDbMock }));

import { getUserRole, grantAdminByEmail, isUserAdmin } from './user-role';

function chainSelect(rows: unknown[]) {
	return {
		from: vi.fn(() => ({
			where: vi.fn(() => ({
				limit: vi.fn(async () => rows)
			}))
		}))
	};
}

function chainUpdate(rows: unknown[]) {
	return {
		set: vi.fn(() => ({
			where: vi.fn(() => ({
				returning: vi.fn(async () => rows)
			}))
		}))
	};
}

describe('user-role', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('isUserAdmin returns true when role is admin', async () => {
		authDbMock.select.mockReturnValue(chainSelect([{ role: 'admin' }]));
		await expect(isUserAdmin('u1')).resolves.toBe(true);
	});

	it('getUserRole defaults to user when row missing', async () => {
		authDbMock.select.mockReturnValue(chainSelect([]));
		await expect(getUserRole('u1')).resolves.toBe('user');
	});

	it('grantAdminByEmail updates by normalized email', async () => {
		authDbMock.update.mockReturnValue(chainUpdate([{ id: 'u1' }]));
		await expect(grantAdminByEmail('  Alex@Example.com  ')).resolves.toBe(true);
	});
});
