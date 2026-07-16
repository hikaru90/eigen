import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissProject } from './project-list';

const { getDbMock } = vi.hoisted(() => ({
	getDbMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

describe('dismissProject', () => {
	beforeEach(() => vi.clearAllMocks());

	it('sets projectStatus to dismissed for the tenant entity', async () => {
		const whereMock = vi.fn(async () => undefined);
		const setMock = vi.fn(() => ({ where: whereMock }));
		const updateMock = vi.fn(() => ({ set: setMock }));
		getDbMock.mockReturnValue({ update: updateMock });

		await dismissProject('user-1', 'entity-1');

		expect(updateMock).toHaveBeenCalled();
		expect(setMock).toHaveBeenCalledWith(
			expect.objectContaining({
				projectStatus: 'dismissed',
				updatedAt: expect.any(Date)
			})
		);
		expect(whereMock).toHaveBeenCalled();
	});
});
