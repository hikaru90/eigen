import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

const { editStoredThoughtMock } = vi.hoisted(() => ({ editStoredThoughtMock: vi.fn() }));
vi.mock('$lib/server/capture/service', () => ({ editStoredThought: editStoredThoughtMock }));

describe('POST /api/capture/edit', () => {
	it('requires auth', async () => {
		await expect(POST({ locals: { user: null }, request: { json: vi.fn(async () => ({})) } } as never)).rejects.toMatchObject({ status: 401 });
	});
});
