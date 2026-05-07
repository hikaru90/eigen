import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

const { searchThoughtsMock } = vi.hoisted(() => ({ searchThoughtsMock: vi.fn() }));
vi.mock('$lib/server/retrieval/service', () => ({ searchThoughts: searchThoughtsMock }));

describe('POST /api/retrieval/search', () => {
	it('requires auth', async () => {
		await expect(POST({ locals: { user: null }, request: { json: vi.fn(async () => ({})) } } as never)).rejects.toMatchObject({ status: 401 });
	});
});
