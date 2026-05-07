import { describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

const { signUpEmailMock } = vi.hoisted(() => ({ signUpEmailMock: vi.fn() }));
vi.mock('$lib/server/auth', () => ({ auth: { api: { signUpEmail: signUpEmailMock } } }));
vi.mock('$lib/server/auth-form-errors', () => ({ getSafeErrorMessage: () => 'safe' }));

describe('register page server', () => {
	it('redirects signed-in users from load', () => {
		expect(() => load({ locals: { user: { id: 'u1' } } } as never)).toThrow();
	});
	it('returns fail on sign-up error', async () => {
		signUpEmailMock.mockRejectedValue(new Error('x'));
		const request = new Request('http://localhost/register', {
			method: 'POST',
			body: new URLSearchParams({ name: 'n', email: 'a@b.com', password: 'pw' })
		});
		const result = await actions.signUpEmail({ request } as never);
		expect(result).toMatchObject({ status: 400 });
	});
});
