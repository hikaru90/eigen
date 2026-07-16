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
	it('constructs better-auth without verification mailer when useSend unset', async () => {
		const mod = await import('./auth');
		expect(mod.auth).toBeDefined();
		expect(betterAuthMock).toHaveBeenCalledWith(
			expect.objectContaining({
				baseURL: mod.normalizeAuthOrigin(env.ORIGIN),
				secret: env.BETTER_AUTH_SECRET,
				emailAndPassword: expect.objectContaining({
					enabled: true,
					requireEmailVerification: false
				}),
				user: expect.objectContaining({
					changeEmail: expect.objectContaining({
						enabled: true,
						updateEmailWithoutVerification: true
					})
				})
			})
		);
		const config = betterAuthMock.mock.calls[0][0] as {
			emailVerification?: unknown;
			emailAndPassword: { sendResetPassword?: unknown };
			user: { changeEmail: { sendChangeEmailConfirmation?: unknown } };
		};
		expect(config.emailVerification).toBeUndefined();
		expect(config.emailAndPassword.sendResetPassword).toBeUndefined();
		expect(config.user.changeEmail.sendChangeEmailConfirmation).toBeUndefined();
	});
});

describe('normalizeAuthOrigin', () => {
	it('prepends https for bare hostnames', async () => {
		const { normalizeAuthOrigin } = await import('./auth');
		expect(normalizeAuthOrigin('eigen.stackstack.de')).toBe('https://eigen.stackstack.de');
	});

	it('leaves full http URLs unchanged aside from trailing slash strip', async () => {
		const { normalizeAuthOrigin } = await import('./auth');
		expect(normalizeAuthOrigin('http://localhost:5173')).toBe('http://localhost:5173');
	});

	it('throws when missing', async () => {
		const { normalizeAuthOrigin } = await import('./auth');
		expect(() => normalizeAuthOrigin(undefined)).toThrow(/ORIGIN is not set/);
	});
});
