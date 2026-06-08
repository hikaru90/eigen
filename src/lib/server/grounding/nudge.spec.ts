import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shouldShowRegroundNudge } from '$lib/server/grounding/nudge';

const { getDbSelectMock } = vi.hoisted(() => ({
	getDbSelectMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: () => ({
		select: getDbSelectMock
	})
}));

describe('shouldShowRegroundNudge', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getDbSelectMock.mockReturnValue({
			from: vi.fn(() => ({
				where: vi.fn(async () => [{ count: 0 }])
			}))
		});
	});

	it('returns false when grounding never completed', async () => {
		const result = await shouldShowRegroundNudge({
			userId: 'u1',
			grounding: { initialCompletedAt: null } as never,
			dismissed: false
		});
		expect(result).toBe(false);
	});

	it('returns true when last session older than 90 days', async () => {
		const old = new Date(Date.now() - 91 * 86_400_000);
		const result = await shouldShowRegroundNudge({
			userId: 'u1',
			grounding: {
				initialCompletedAt: new Date('2025-01-01'),
				lastSessionAt: old,
				facets: {},
				narrativeSummary: '',
				sessionCount: 1
			},
			dismissed: false
		});
		expect(result).toBe(true);
	});

	it('returns false when dismissed', async () => {
		const result = await shouldShowRegroundNudge({
			userId: 'u1',
			grounding: {
				initialCompletedAt: new Date('2025-01-01'),
				lastSessionAt: new Date(Date.now() - 91 * 86_400_000),
				facets: {},
				narrativeSummary: '',
				sessionCount: 1
			},
			dismissed: true
		});
		expect(result).toBe(false);
	});
});
