import { describe, expect, it, vi, beforeEach } from 'vitest';
import { syncThoughtEntityLinks } from '$lib/server/retrieval/materialize-links';

const { deleteWhereMock, insertValuesMock, selectWhereMock } = vi.hoisted(() => ({
	deleteWhereMock: vi.fn(),
	insertValuesMock: vi.fn(),
	selectWhereMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: () => ({
		delete: vi.fn(() => ({ where: deleteWhereMock })),
		insert: vi.fn(() => ({ values: insertValuesMock })),
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: selectWhereMock
			}))
		}))
	})
}));

describe('syncThoughtEntityLinks', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		selectWhereMock.mockResolvedValue([
			{ entityId: 'e1', confidence: 'high' }
		]);
	});

	it('deletes only ingest-sourced links before rebuild', async () => {
		await syncThoughtEntityLinks('u1', 't1');
		expect(deleteWhereMock).toHaveBeenCalledTimes(1);
	});

	it('reinserts ingest links with source=ingest', async () => {
		await syncThoughtEntityLinks('u1', 't1');
		expect(insertValuesMock).toHaveBeenCalledWith([
			expect.objectContaining({
				userId: 'u1',
				thoughtId: 't1',
				entityId: 'e1',
				source: 'ingest'
			})
		]);
	});
});
