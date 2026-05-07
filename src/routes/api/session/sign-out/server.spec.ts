import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

const { signOutMock } = vi.hoisted(() => ({ signOutMock: vi.fn() }));
vi.mock('$lib/server/auth', () => ({ auth: { api: { signOut: signOutMock } } }));

describe('POST /api/session/sign-out', () => {
	it('returns ok', async () => {
		const request = new Request('http://localhost/api/session/sign-out', { method: 'POST' });
		const res = await POST({ request } as never);
		expect(await res.json()).toEqual({ ok: true });
	});
});
