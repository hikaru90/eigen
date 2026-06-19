import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

const { linkTextFileToThoughtMock } = vi.hoisted(() => ({
	linkTextFileToThoughtMock: vi.fn()
}));

vi.mock('$lib/server/text-files/service', () => ({
	linkTextFileToThought: linkTextFileToThoughtMock
}));

describe('POST /api/thoughts/[thoughtId]/text-files', () => {
	it('requires auth', async () => {
		await expect(
			POST({
				locals: { user: null },
				params: { thoughtId: 't1' },
				request: new Request('http://localhost', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ textFileId: 'f1' })
				})
			} as never)
		).rejects.toMatchObject({ status: 401 });
	});

	it('links file to thought', async () => {
		linkTextFileToThoughtMock.mockResolvedValue({ linked: true });
		const res = await POST({
			locals: { user: { id: 'u1' } },
			params: { thoughtId: 't1' },
			request: new Request('http://localhost', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ textFileId: 'f1' })
			})
		} as never);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.linked).toBe(true);
	});
});
