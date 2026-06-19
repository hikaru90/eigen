import { describe, expect, it, vi } from 'vitest';
import { GET, POST } from './+server';

const { listTextFilesMock, createTextFileMock } = vi.hoisted(() => ({
	listTextFilesMock: vi.fn(),
	createTextFileMock: vi.fn()
}));

vi.mock('$lib/server/text-files/service', () => ({
	listTextFiles: listTextFilesMock,
	createTextFile: createTextFileMock
}));

describe('/api/text-files', () => {
	it('GET requires auth', async () => {
		await expect(GET({ locals: { user: null }, url: new URL('http://localhost') } as never)).rejects.toMatchObject({
			status: 401
		});
	});

	it('GET returns listed files', async () => {
		listTextFilesMock.mockResolvedValue([{ id: 'f1', title: 'A', body: 'x' }]);
		const res = await GET({
			locals: { user: { id: 'u1' } },
			url: new URL('http://localhost/api/text-files?limit=5')
		} as never);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.count).toBe(1);
	});

	it('POST creates a file', async () => {
		createTextFileMock.mockResolvedValue({
			id: 'f1',
			title: 'T',
			body: 'hello',
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z'
		});
		const res = await POST({
			locals: { user: { id: 'u1' } },
			request: new Request('http://localhost', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ body: 'hello', title: 'T' })
			})
		} as never);
		expect(res.status).toBe(201);
	});
});
