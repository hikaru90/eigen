import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './+server';

const { listTextFilesMock, createTextFileMock, searchTextFilesMock } = vi.hoisted(() => ({
	listTextFilesMock: vi.fn(),
	createTextFileMock: vi.fn(),
	searchTextFilesMock: vi.fn()
}));

vi.mock('$lib/server/text-files/service', () => ({
	listTextFiles: listTextFilesMock,
	createTextFile: createTextFileMock,
	searchTextFiles: searchTextFilesMock
}));

describe('/api/text-files', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

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

	it('GET with q runs lexical search', async () => {
		searchTextFilesMock.mockResolvedValue([
			{
				id: 'f1',
				title: 'Recipe',
				preview: 'pasta…',
				lexicalScore: 0.2,
				updatedAt: '2026-01-01T00:00:00.000Z'
			}
		]);
		const res = await GET({
			locals: { user: { id: 'u1' } },
			url: new URL('http://localhost/api/text-files?q=carbonara&limit=5')
		} as never);
		expect(res.status).toBe(200);
		expect(searchTextFilesMock).toHaveBeenCalledWith('u1', {
			query: 'carbonara',
			topK: 5,
			authorLayerKey: null
		});
		const body = await res.json();
		expect(body.results[0].id).toBe('f1');
		expect(listTextFilesMock).not.toHaveBeenCalled();
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
