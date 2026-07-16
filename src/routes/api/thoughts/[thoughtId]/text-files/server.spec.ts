import { describe, expect, it, vi } from 'vitest';
import { GET, POST } from './+server';

const { linkTextFileToThoughtMock, listTextFilesForThoughtMock } = vi.hoisted(() => ({
	linkTextFileToThoughtMock: vi.fn(),
	listTextFilesForThoughtMock: vi.fn()
}));

vi.mock('$lib/server/text-files/service', () => ({
	linkTextFileToThought: linkTextFileToThoughtMock,
	listTextFilesForThought: listTextFilesForThoughtMock
}));

describe('GET /api/thoughts/[thoughtId]/text-files', () => {
	it('requires auth', async () => {
		await expect(
			GET({
				locals: { user: null },
				params: { thoughtId: 't1' }
			} as never)
		).rejects.toMatchObject({ status: 401 });
	});

	it('lists attached files', async () => {
		listTextFilesForThoughtMock.mockResolvedValue([{ id: 'f1' }]);
		const res = await GET({
			locals: { user: { id: 'u1' } },
			params: { thoughtId: 't1' }
		} as never);
		expect(await res.json()).toEqual({ attachedFiles: [{ id: 'f1' }] });
	});
});

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

	it('maps thought_not_found to 404', async () => {
		linkTextFileToThoughtMock.mockResolvedValue({ linked: false, reason: 'thought_not_found' });
		await expect(
			POST({
				locals: { user: { id: 'u1' } },
				params: { thoughtId: 't1' },
				request: new Request('http://localhost', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ textFileId: 'f1' })
				})
			} as never)
		).rejects.toMatchObject({ status: 404 });
	});
});
