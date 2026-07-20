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

	it('removes thought-entity links and sets projectStatus to dismissed', async () => {
		const deleteWhereMock = vi.fn(async () => undefined);
		const deleteMock = vi.fn(() => ({ where: deleteWhereMock }));

		const updateWhereMock = vi.fn(async () => undefined);
		const updateSetMock = vi.fn(() => ({ where: updateWhereMock }));
		const updateMock = vi.fn(() => ({ set: updateSetMock }));

		getDbMock.mockReturnValue({ delete: deleteMock, update: updateMock });

		await dismissProject('user-1', 'entity-1');

		// 1) thoughtEntity rows for this entity should be deleted
		expect(deleteMock).toHaveBeenCalled();
		expect(deleteWhereMock).toHaveBeenCalled();

		// 2) canonicalEntity should be set to dismissed with nextActionThoughtId cleared
		expect(updateMock).toHaveBeenCalled();
		expect(updateSetMock).toHaveBeenCalledWith(
			expect.objectContaining({
				projectStatus: 'dismissed',
				nextActionThoughtId: null,
				updatedAt: expect.any(Date)
			})
		);
		expect(updateWhereMock).toHaveBeenCalled();
	});
});
