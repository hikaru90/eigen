import { describe, expect, it, vi } from 'vitest';
import { actions } from './+page.server';

const { signInEmailMock } = vi.hoisted(() => ({ signInEmailMock: vi.fn() }));
vi.mock('$lib/server/auth', () => ({ auth: { api: { signInEmail: signInEmailMock } } }));
vi.mock('$lib/server/auth-form-errors', () => ({ getSafeErrorMessage: (e: unknown) => `safe: ${e}` }));

describe('login page server', () => {
	it('returns validation error for empty email', async () => {
		const request = new Request('http://localhost/login', {
			method: 'POST',
			body: new URLSearchParams({ email: '', password: 'pass123' })
		});
		const result = await actions.signInEmail({ request } as never);
		expect(result).toMatchObject({ status: 400, data: { message: 'Invalid email address' } });
	});

	it('returns validation error for empty password', async () => {
		const request = new Request('http://localhost/login', {
			method: 'POST',
			body: new URLSearchParams({ email: 'test@example.com', password: '' })
		});
		const result = await actions.signInEmail({ request } as never);
		expect(result).toMatchObject({ status: 400, data: { message: 'Password is required' } });
	});

	it('returns auth error on sign-in failure', async () => {
		signInEmailMock.mockRejectedValue(new Error('Invalid credentials'));
		const request = new Request('http://localhost/login', {
			method: 'POST',
			body: new URLSearchParams({ email: 'test@example.com', password: 'wrong' })
		});
		const result = await actions.signInEmail({ request } as never);
		expect(result).toMatchObject({ status: 401 });
		expect(result.data.message).toContain('safe:');
		expect(result.data.message).toContain('Invalid credentials');
	});

	it('returns safe error message on unknown error', async () => {
		signInEmailMock.mockRejectedValue(new Error('Network error'));
		const request = new Request('http://localhost/login', {
			method: 'POST',
			body: new URLSearchParams({ email: 'test@example.com', password: 'pass123' })
		});
		const result = await actions.signInEmail({ request } as never);
		expect(result).toMatchObject({ status: 401 });
		expect(result.data.message).toContain('safe:');
		expect(result.data.message).toContain('Network error');
	});
});
