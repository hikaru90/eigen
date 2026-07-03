import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

const { listPendingEnrichThoughtIdsMock, scheduleCaptureEnrichWorkerMock, recoverStaleMock, requeueOrphanedMock, shouldScheduleDevCaptureEnrichWorkerMock } =
	vi.hoisted(() => ({
		listPendingEnrichThoughtIdsMock: vi.fn(),
		scheduleCaptureEnrichWorkerMock: vi.fn(),
		recoverStaleMock: vi.fn(),
		requeueOrphanedMock: vi.fn(),
		shouldScheduleDevCaptureEnrichWorkerMock: vi.fn()
	}));

vi.mock('$lib/server/capture/enrich-pending', () => ({
	listPendingEnrichThoughtIds: listPendingEnrichThoughtIdsMock
}));

vi.mock('$lib/server/capture/capture-enrich-worker', () => ({
	scheduleCaptureEnrichWorker: scheduleCaptureEnrichWorkerMock
}));

vi.mock('$lib/server/capture/queue-capture', () => ({
	recoverStaleEnrichProcessingRows: recoverStaleMock,
	requeueOrphanedCompleteEnrichRows: requeueOrphanedMock
}));

vi.mock('$lib/server/auth/harness-account', () => ({
	shouldScheduleDevCaptureEnrichWorker: shouldScheduleDevCaptureEnrichWorkerMock
}));

describe('GET /api/capture/enrich-pending', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		recoverStaleMock.mockResolvedValue(0);
		requeueOrphanedMock.mockResolvedValue(0);
		shouldScheduleDevCaptureEnrichWorkerMock.mockResolvedValue(true);
	});

	it('requires auth', async () => {
		await expect(GET({ locals: { user: null } } as never)).rejects.toMatchObject({ status: 401 });
	});

	it('returns pending thought ids', async () => {
		listPendingEnrichThoughtIdsMock.mockResolvedValue(['t1', 't2']);
		const res = await GET({ locals: { user: { id: 'u1' } } } as never);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ thoughtIds: ['t1', 't2'] });
	});

	it('recovers stale rows and requeues orphaned complete rows before listing', async () => {
		recoverStaleMock.mockResolvedValue(1);
		requeueOrphanedMock.mockResolvedValue(2);
		listPendingEnrichThoughtIdsMock.mockResolvedValue(['t1']);
		await GET({ locals: { user: { id: 'u1' } } } as never);
		expect(recoverStaleMock).toHaveBeenCalledWith('u1');
		expect(requeueOrphanedMock).toHaveBeenCalledWith('u1');
	});

	it('schedules enrich worker when queue is non-empty', async () => {
		listPendingEnrichThoughtIdsMock.mockResolvedValue(['t1']);
		await GET({ locals: { user: { id: 'u1' } } } as never);
		expect(scheduleCaptureEnrichWorkerMock).toHaveBeenCalledWith('u1');
	});

	it('does not schedule worker when queue is empty', async () => {
		listPendingEnrichThoughtIdsMock.mockResolvedValue([]);
		await GET({ locals: { user: { id: 'u1' } } } as never);
		expect(scheduleCaptureEnrichWorkerMock).not.toHaveBeenCalled();
	});

	it('does not schedule enrich worker for harness corpus tenants', async () => {
		shouldScheduleDevCaptureEnrichWorkerMock.mockResolvedValue(false);
		listPendingEnrichThoughtIdsMock.mockResolvedValue(['t1']);
		await GET({ locals: { user: { id: 'graph-scale-corpus-run-1' } } } as never);
		expect(scheduleCaptureEnrichWorkerMock).not.toHaveBeenCalled();
	});

	it('schedules enrich worker for graph-scale spend probe tenants', async () => {
		shouldScheduleDevCaptureEnrichWorkerMock.mockResolvedValue(true);
		listPendingEnrichThoughtIdsMock.mockResolvedValue(['t1']);
		await GET({ locals: { user: { id: 'graph-scale-spend-abc' } } } as never);
		expect(scheduleCaptureEnrichWorkerMock).toHaveBeenCalledWith('graph-scale-spend-abc');
	});
});
