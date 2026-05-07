import { describe, expect, it, vi } from 'vitest';

const betterAuthMock = vi.fn((config: unknown) => ({ config }));
const drizzleAdapterMock = vi.fn(() => ({ adapter: 'drizzle' }));
const sveltekitCookiesMock = vi.fn(() => ({ plugin: 'cookies' }));

const env = {
	ORIGIN: 'http://localhost:5173',
	BETTER_AUTH_SECRET: 'secret'
};

vi.mock('better-auth/minimal', () => ({
	betterAuth: betterAuthMock
}));

vi.mock('better-auth/adapters/drizzle', () => ({
	drizzleAdapter: drizzleAdapterMock
}));

vi.mock('better-auth/svelte-kit', () => ({
	sveltekitCookies: sveltekitCookiesMock
}));

vi.mock('$env/dynamic/private', () => ({
	env
}));

vi.mock('$app/server', () => ({
	getRequestEvent: vi.fn()
}));

vi.mock('$lib/server/db/auth-db', () => ({
	authDb: {}
}));

describe('auth config', () => {
	it('constructs better-auth with expected fields', async () => {
		const mod = await import('./auth');
		expect(mod.auth).toBeDefined();
		expect(drizzleAdapterMock).toHaveBeenCalled();
		expect(sveltekitCookiesMock).toHaveBeenCalled();
		expect(betterAuthMock).toHaveBeenCalledWith(
			expect.objectContaining({
				baseURL: env.ORIGIN,
				secret: env.BETTER_AUTH_SECRET,
				emailAndPassword: { enabled: true }
			})
		);
	});
});
