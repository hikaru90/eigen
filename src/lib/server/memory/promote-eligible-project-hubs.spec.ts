import { beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluateHubsForGtdPromotion } from './promote-eligible-project-hubs';

const { getDbMock, promoteMock } = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	promoteMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/memory/maybe-promote-gtd-project', () => ({
	maybePromoteHubToGtdProject: promoteMock
}));

describe('evaluateHubsForGtdPromotion', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		promoteMock.mockResolvedValue(false);
	});

	it('returns 0 for empty entity ids without querying', async () => {
		const promoted = await evaluateHubsForGtdPromotion('u1', []);
		expect(promoted).toBe(0);
		expect(getDbMock).not.toHaveBeenCalled();
	});

	it('dedupes ids and counts successful promotions', async () => {
		const where = vi.fn(async () => [{ id: 'e1' }, { id: 'e2' }]);
		const from = vi.fn(() => ({ where }));
		const select = vi.fn(() => ({ from }));
		getDbMock.mockReturnValue({ select });
		promoteMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

		const promoted = await evaluateHubsForGtdPromotion('u1', ['e1', 'e1', 'e2'], {
			forceJudge: true
		});

		expect(promoted).toBe(1);
		expect(promoteMock).toHaveBeenCalledTimes(2);
		expect(promoteMock).toHaveBeenCalledWith({
			userId: 'u1',
			entityId: 'e1',
			source: 'capture',
			forceJudge: true
		});
	});
});
