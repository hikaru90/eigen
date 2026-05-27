import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as db from './db';
import * as submit from './submit-capture';
import { processCaptureQueueItem } from './process-item';
import type { CaptureQueueItem } from './types';

const baseItem: CaptureQueueItem = {
	id: 'q1',
	raw: 'test thought',
	createdAt: 1,
	status: 'pending',
	attempts: 0
};

describe('processCaptureQueueItem', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('deletes item and returns done on success', async () => {
		vi.spyOn(db, 'setCaptureQueueStatus').mockResolvedValue({ ...baseItem, status: 'processing' });
		vi.spyOn(submit, 'submitCaptureRaw').mockResolvedValue({
			id: 't1',
			normalizedText: 'test',
			category: 'thought'
		});
		const del = vi.spyOn(db, 'deleteCaptureQueueItem').mockResolvedValue();

		const result = await processCaptureQueueItem(baseItem);
		expect(result.outcome).toBe('done');
		expect(del).toHaveBeenCalledWith('q1');
	});

	it('re-queues as pending when offline', async () => {
		vi.spyOn(db, 'setCaptureQueueStatus').mockResolvedValue({ ...baseItem, status: 'processing' });
		vi.spyOn(submit, 'submitCaptureRaw').mockRejectedValue(new TypeError('Failed to fetch'));
		vi.spyOn(submit, 'isLikelyOfflineError').mockReturnValue(true);
		const pending = vi
			.spyOn(db, 'setCaptureQueueStatus')
			.mockResolvedValueOnce({ ...baseItem, status: 'processing' })
			.mockResolvedValueOnce({ ...baseItem, status: 'pending' });

		const result = await processCaptureQueueItem(baseItem);
		expect(result.outcome).toBe('offline');
		expect(pending).toHaveBeenCalled();
	});

	it('marks failed immediately on permission errors', async () => {
		vi.spyOn(db, 'setCaptureQueueStatus').mockResolvedValue({ ...baseItem, status: 'processing' });
		vi.spyOn(submit, 'submitCaptureRaw').mockRejectedValue(
			new Error('permission denied for sequence Thought_id_seq')
		);
		vi.spyOn(submit, 'isLikelyOfflineError').mockReturnValue(false);
		vi.spyOn(db, 'updateCaptureQueueItem').mockResolvedValue({
			...baseItem,
			status: 'failed',
			attempts: 1,
			lastError: 'permission denied for sequence Thought_id_seq'
		});

		const result = await processCaptureQueueItem(baseItem);
		expect(result.outcome).toBe('failed');
	});

	it('marks failed after max attempts', async () => {
		vi.spyOn(db, 'setCaptureQueueStatus').mockResolvedValue({ ...baseItem, status: 'processing' });
		vi.spyOn(submit, 'submitCaptureRaw').mockRejectedValue(new Error('server error'));
		vi.spyOn(submit, 'isLikelyOfflineError').mockReturnValue(false);
		vi.spyOn(db, 'updateCaptureQueueItem').mockResolvedValue({
			...baseItem,
			status: 'failed',
			attempts: 3,
			lastError: 'server error'
		});

		const result = await processCaptureQueueItem({ ...baseItem, attempts: 2 });
		expect(result.outcome).toBe('failed');
		if (result.outcome === 'failed') expect(result.error).toBe('server error');
	});
});
