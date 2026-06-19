import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isGroundingQuestionDue } from '$lib/server/grounding/question-due';

const { countMock, loadGroundingProfileRowMock } = vi.hoisted(() => ({
	countMock: vi.fn(),
	loadGroundingProfileRowMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: () => ({
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: countMock
			}))
		}))
	})
}));

vi.mock('$lib/server/grounding/profile', () => ({
	loadGroundingProfileRow: loadGroundingProfileRowMock
}));

describe('isGroundingQuestionDue', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		countMock.mockResolvedValue([{ count: 10 }]);
		loadGroundingProfileRowMock.mockResolvedValue(null);
	});

	it('is due on capture interval with no recent prompt', async () => {
		expect(await isGroundingQuestionDue('u1')).toBe(true);
	});

	it('is not due when thought count is zero', async () => {
		countMock.mockResolvedValue([{ count: 0 }]);
		expect(await isGroundingQuestionDue('u1')).toBe(false);
	});

	it('is not due when last prompt was recent', async () => {
		loadGroundingProfileRowMock.mockResolvedValue({
			lastSessionAt: new Date(),
			facets: {},
			sessionCount: 1
		});
		expect(await isGroundingQuestionDue('u1')).toBe(false);
	});

	it('is not due off-interval capture counts', async () => {
		countMock.mockResolvedValue([{ count: 11 }]);
		expect(await isGroundingQuestionDue('u1')).toBe(false);
	});
});
