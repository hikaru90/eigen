import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

function event(overrides: { user?: { id: string } | null; body?: unknown } = {}) {
	return {
		locals: { user: overrides.user === undefined ? { id: 'u1' } : overrides.user },
		request: new Request('http://localhost/api/log/error', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(overrides.body ?? {})
		})
	} as Parameters<typeof POST>[0];
}

describe('POST /api/log/error', () => {
	it('returns ok without logging when unauthenticated', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const res = await POST(event({ user: null }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(consoleSpy).not.toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it('returns ok when body is invalid JSON', async () => {
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: new Request('http://localhost/api/log/error', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: 'not-json'
			})
		} as Parameters<typeof POST>[0]);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	it('logs client error with context and truncated stack', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const longStack = 'x'.repeat(600);
		const res = await POST(
			event({ body: { message: 'boom', context: 'ui', stack: longStack } })
		);
		expect(res.status).toBe(200);
		expect(consoleSpy).toHaveBeenCalledWith(
			'[client.ui] boom',
			expect.objectContaining({ userId: 'u1', stack: longStack.slice(0, 500) })
		);
		consoleSpy.mockRestore();
	});

	it('defaults message and context when missing', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const res = await POST(event({ body: {} }));
		expect(res.status).toBe(200);
		expect(consoleSpy).toHaveBeenCalledWith(
			'[client.client] unknown error',
			expect.objectContaining({ userId: 'u1' })
		);
		consoleSpy.mockRestore();
	});
});
