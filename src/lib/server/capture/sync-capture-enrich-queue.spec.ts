import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	completeEnrichedMock,
	recoverStaleMock,
	requeueInFlightMock,
	requeueOrphanedMock,
	listPendingMock,
	shouldScheduleMock,
	scheduleWorkerMock,
	isWorkerActiveMock
} = vi.hoisted(() => ({
	completeEnrichedMock: vi.fn(),
	recoverStaleMock: vi.fn(),
	requeueInFlightMock: vi.fn(),
	requeueOrphanedMock: vi.fn(),
	listPendingMock: vi.fn(),
	shouldScheduleMock: vi.fn(),
	scheduleWorkerMock: vi.fn(),
	isWorkerActiveMock: vi.fn()
}));

vi.mock('$lib/server/capture/queue-capture', () => ({
	completeEnrichedQueueRows: completeEnrichedMock,
	recoverStaleEnrichProcessingRows: recoverStaleMock,
	requeueInFlightProcessingRows: requeueInFlightMock,
	requeueOrphanedCompleteEnrichRows: requeueOrphanedMock
}));

vi.mock('$lib/server/capture/enrich-pending', () => ({
	listPendingEnrichThoughtIds: listPendingMock
}));

vi.mock('$lib/server/auth/harness-account', () => ({
	shouldScheduleDevCaptureEnrichWorker: shouldScheduleMock
}));

vi.mock('$lib/server/capture/capture-enrich-worker', () => ({
	scheduleCaptureEnrichWorker: scheduleWorkerMock,
	isCaptureEnrichWorkerActive: isWorkerActiveMock
}));

import {
	syncAndScheduleCaptureEnrichQueue,
	syncCaptureEnrichQueue
} from './sync-capture-enrich-queue';

describe('syncCaptureEnrichQueue', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		completeEnrichedMock.mockResolvedValue(0);
		recoverStaleMock.mockResolvedValue(0);
		requeueInFlightMock.mockResolvedValue(0);
		requeueOrphanedMock.mockResolvedValue(0);
		listPendingMock.mockResolvedValue([]);
		isWorkerActiveMock.mockReturnValue(false);
	});

	it('recovers stale rows and lists active queue ids', async () => {
		recoverStaleMock.mockResolvedValue(2);
		requeueOrphanedMock.mockResolvedValue(1);
		listPendingMock.mockResolvedValue(['t1']);

		const result = await syncCaptureEnrichQueue('u1');
		expect(result).toEqual({
			finalizedEnriched: 0,
			recoveredStale: 2,
			requeuedInFlight: 0,
			requeuedOrphaned: 1,
			activeThoughtIds: ['t1']
		});
	});

	it('requeues in-flight processing rows when worker is idle', async () => {
		requeueInFlightMock.mockResolvedValue(1);
		await syncCaptureEnrichQueue('u1');
		expect(requeueInFlightMock).toHaveBeenCalledWith('u1');
	});

	it('skips in-flight requeue while worker is active', async () => {
		isWorkerActiveMock.mockReturnValue(true);
		await syncCaptureEnrichQueue('u1');
		expect(requeueInFlightMock).not.toHaveBeenCalled();
	});
});

describe('syncAndScheduleCaptureEnrichQueue', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		completeEnrichedMock.mockResolvedValue(0);
		recoverStaleMock.mockResolvedValue(0);
		requeueInFlightMock.mockResolvedValue(0);
		requeueOrphanedMock.mockResolvedValue(0);
		listPendingMock.mockResolvedValue([]);
		shouldScheduleMock.mockResolvedValue(true);
		isWorkerActiveMock.mockReturnValue(false);
	});

	it('schedules worker when queue has active rows', async () => {
		listPendingMock.mockResolvedValue(['t1']);
		await syncAndScheduleCaptureEnrichQueue('u1');
		expect(scheduleWorkerMock).toHaveBeenCalledWith('u1');
	});

	it('does not schedule worker when queue is empty', async () => {
		await syncAndScheduleCaptureEnrichQueue('u1');
		expect(scheduleWorkerMock).not.toHaveBeenCalled();
	});

	it('does not schedule worker for harness tenants', async () => {
		listPendingMock.mockResolvedValue(['t1']);
		shouldScheduleMock.mockResolvedValue(false);
		await syncAndScheduleCaptureEnrichQueue('harness-user');
		expect(scheduleWorkerMock).not.toHaveBeenCalled();
	});
});
