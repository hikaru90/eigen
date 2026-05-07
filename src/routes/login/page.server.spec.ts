import { describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

const { signInEmailMock } = vi.hoisted(() => ({ signInEmailMock: vi.fn() }));
vi.mock('$lib/server/auth', () => ({ auth: { api: { signInEmail: signInEmailMock } } }));
vi.mock('$lib/server/auth-form-errors', () => ({ getSafeErrorMessage: () => 'safe' }));

describe('login page server', () => {
	it('redirects signed-in users from load', () => {
		expect(() => load({ locals: { user: { id: 'u1' } } } as never)).toThrow();
	});
	it('returns fail on sign-in error', async () => {
		signInEmailMock.mockRejectedValue(new Error('x'));
		const request = new Request('http://localhost/login', { method: 'POST', body: new URLSearchParams() });
		const result = await actions.signInEmail({ request } as never);
		expect(result).toMatchObject({ status: 400 });
	});
});
