import {
	deleteCaptureQueueItem,
	setCaptureQueueStatus,
	updateCaptureQueueItem
} from './db';
import { isLikelyOfflineError, submitCaptureRaw } from './submit-capture';
import type { CaptureQueueItem, CaptureSubmitResult } from './types';
import type { ProgressEvent } from '$lib/capture/consume-capture-ndjson';

const MAX_BACKGROUND_ATTEMPTS = 3;

export type ProcessCaptureItemOptions = {
	signal?: AbortSignal;
	onProgress?: (event: ProgressEvent) => void;
	streamProgress?: boolean;
};

export type ProcessCaptureItemResult =
	| { outcome: 'done'; thought: CaptureSubmitResult }
	| { outcome: 'offline'; item: CaptureQueueItem }
	| { outcome: 'retry'; item: CaptureQueueItem; error: string }
	| { outcome: 'failed'; item: CaptureQueueItem; error: string };

export async function processCaptureQueueItem(
	item: CaptureQueueItem,
	options?: ProcessCaptureItemOptions
): Promise<ProcessCaptureItemResult> {
	await setCaptureQueueStatus(item.id, 'processing');

	try {
		const thought = await submitCaptureRaw(item.raw, {
			signal: options?.signal,
			onProgress: options?.onProgress,
			streamProgress: options?.streamProgress
		});
		await deleteCaptureQueueItem(item.id);
		return { outcome: 'done', thought };
	} catch (err) {
		if (options?.signal?.aborted) {
			await setCaptureQueueStatus(item.id, 'pending');
			throw err;
		}

		if (isLikelyOfflineError(err)) {
			const pending = await setCaptureQueueStatus(item.id, 'pending');
			return { outcome: 'offline', item: pending ?? item };
		}

		const attempts = item.attempts + 1;
		const message = err instanceof Error ? err.message : String(err);
		if (attempts >= MAX_BACKGROUND_ATTEMPTS) {
			const failed = await updateCaptureQueueItem(item.id, {
				status: 'failed',
				attempts,
				lastError: message
			});
			return {
				outcome: 'failed',
				item: failed ?? { ...item, status: 'failed', attempts, lastError: message },
				error: message
			};
		}

		const retry = await updateCaptureQueueItem(item.id, {
			status: 'pending',
			attempts,
			lastError: message
		});
		return { outcome: 'retry', item: retry ?? item, error: message };
	}
}
