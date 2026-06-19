import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	getDbMock,
	scheduleCaptureEnrichWorkerMock,
	selectMock,
	updateMock
} = vi.hoisted(() => ({
	getDbMock: vi.fn(),
	scheduleCaptureEnrichWorkerMock: vi.fn(),
	selectMock: vi.fn(),
	updateMock: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	getDb: getDbMock
}));

vi.mock('$lib/server/capture/capture-enrich-worker', () => ({
	scheduleCaptureEnrichWorker: scheduleCaptureEnrichWorkerMock
}));

import {
	recoverStaleEnrichProcessingRows,
	requeueEnrichThought,
	requeueOrphanedCompleteEnrichRows
} from './queue-capture';

describe('recoverStaleEnrichProcessingRows', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getDbMock.mockReturnValue({
			select: selectMock,
			update: updateMock
		});
	});

	it('returns 0 when no stale rows', async () => {
		selectMock.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue([])
			})
		});

		const recovered = await recoverStaleEnrichProcessingRows('u1');
		expect(recovered).toBe(0);
		expect(updateMock).not.toHaveBeenCalled();
	});

	it('requeues stale processing rows', async () => {
		selectMock.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue([{ id: 't1' }, { id: 't2' }])
			})
		});
		updateMock.mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue(undefined)
			})
		});

		const recovered = await recoverStaleEnrichProcessingRows('u1', 60_000);
		expect(recovered).toBe(2);
		expect(updateMock).toHaveBeenCalled();
	});
});

describe('requeueEnrichThought', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getDbMock.mockReturnValue({
			select: selectMock,
			update: updateMock
		});
	});

	it('returns not_found when thought missing', async () => {
		selectMock.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([])
				})
			})
		});

		const result = await requeueEnrichThought('u1', 'missing');
		expect(result).toEqual({ ok: false, reason: 'not_found' });
	});

	it('returns not_retryable for complete rows with enriched_at', async () => {
		selectMock.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([
						{ id: 't1', enrichQueueStatus: 'complete', enrichedAt: new Date() }
					])
				})
			})
		});

		const result = await requeueEnrichThought('u1', 't1');
		expect(result).toEqual({ ok: false, reason: 'not_retryable' });
	});

	it('requeues failed rows and schedules worker', async () => {
		selectMock.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([{ id: 't1', enrichQueueStatus: 'failed', enrichedAt: null }])
				})
			})
		});
		updateMock.mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue(undefined)
			})
		});

		const result = await requeueEnrichThought('u1', 't1');
		expect(result).toEqual({ ok: true });
		expect(scheduleCaptureEnrichWorkerMock).toHaveBeenCalledWith('u1');
	});

	it('requeues complete rows missing enriched_at', async () => {
		selectMock.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					limit: vi.fn().mockResolvedValue([
						{ id: 't1', enrichQueueStatus: 'complete', enrichedAt: null }
					])
				})
			})
		});
		updateMock.mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue(undefined)
			})
		});

		const result = await requeueEnrichThought('u1', 't1');
		expect(result).toEqual({ ok: true });
		expect(scheduleCaptureEnrichWorkerMock).toHaveBeenCalledWith('u1');
	});
});

describe('requeueOrphanedCompleteEnrichRows', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getDbMock.mockReturnValue({
			select: selectMock,
			update: updateMock
		});
	});

	it('returns 0 when no orphaned rows', async () => {
		selectMock.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue([])
			})
		});

		const requeued = await requeueOrphanedCompleteEnrichRows('u1');
		expect(requeued).toBe(0);
		expect(updateMock).not.toHaveBeenCalled();
	});

	it('requeues complete rows without enriched_at', async () => {
		selectMock.mockReturnValue({
			from: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue([{ id: 't1' }])
			})
		});
		updateMock.mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue(undefined)
			})
		});

		const requeued = await requeueOrphanedCompleteEnrichRows('u1');
		expect(requeued).toBe(1);
		expect(updateMock).toHaveBeenCalled();
	});
});
