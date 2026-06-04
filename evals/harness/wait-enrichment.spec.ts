import { beforeEach, describe, expect, it, vi } from 'vitest';

const { withEvalDbMock, reenrichThoughtMock, selectDistinctMock } = vi.hoisted(() => ({
	withEvalDbMock: vi.fn(),
	reenrichThoughtMock: vi.fn(),
	selectDistinctMock: vi.fn()
}));

vi.mock('./eval-context', () => ({
	withEvalDb: withEvalDbMock,
	logEval: vi.fn()
}));

vi.mock('$lib/server/capture/enrich', () => ({
	reenrichThought: reenrichThoughtMock
}));

vi.mock('./concurrency', () => ({
	mapWithConcurrency: async <T>(
		items: T[],
		_concurrency: number,
		fn: (item: T) => Promise<void>
	) => {
		for (const item of items) {
			await fn(item);
		}
	}
}));

describe('waitForThoughtEnrichment', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		reenrichThoughtMock.mockResolvedValue(undefined);
		selectDistinctMock.mockResolvedValue([]);
		withEvalDbMock.mockImplementation(
			async (_userId: string, fn: () => Promise<void>, _options?: { billingUserId?: string }) => {
				await fn();
			}
		);
	});

	it('passes billingUserId into withEvalDb when kicking re-enrich', async () => {
		const db = {
			selectDistinct: vi.fn(() => ({
				from: vi.fn(() => ({
					where: vi.fn(() => selectDistinctMock())
				}))
			}))
		};

		const { waitForThoughtEnrichment } = await import('./wait-enrichment');

		await expect(
			waitForThoughtEnrichment({
				db: db as never,
				userId: 'eval-tenant-1',
				targets: [{ id: 'thought-1', normalizedText: 'Jonas needs silence.' }],
				timeoutMs: 100,
				withEvalDbOptions: { billingUserId: 'operator-1' }
			})
		).rejects.toThrow(/enrichment timeout/);

		expect(withEvalDbMock).toHaveBeenCalledWith(
			'eval-tenant-1',
			expect.any(Function),
			{ billingUserId: 'operator-1' }
		);
	});
});
