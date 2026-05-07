import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

const { captureThoughtMock } = vi.hoisted(() => ({ captureThoughtMock: vi.fn() }));
vi.mock('$lib/server/capture/service', () => ({ captureThought: captureThoughtMock }));

describe('POST /api/capture/submit', () => {
	it('requires auth', async () => {
		await expect(POST({ locals: { user: null }, request: { json: vi.fn(async () => ({})) } } as never)).rejects.toMatchObject({ status: 401 });
	});
});
