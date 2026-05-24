import { getNextPendingCaptureItem, listCaptureQueueItems } from './db';
import { processCaptureQueueItem } from './process-item';
import { registerCaptureQueueBackgroundSync } from './sync-registration';
import type { ProgressEvent } from '$lib/capture/consume-capture-ndjson';
import type { CaptureQueueBroadcast, CaptureSubmitResult } from './types';

export type DrainCaptureQueueOptions = {
	signal?: AbortSignal;
	onProgress?: (id: string, event: ProgressEvent) => void;
	streamProgress?: boolean;
	broadcast?: (message: CaptureQueueBroadcast) => void;
};

export type DrainCaptureQueueResult = {
	processed: number;
	stoppedForOffline: boolean;
};

/** Processes pending capture queue items one at a time until empty or offline. */
export async function drainCaptureQueue(
	options?: DrainCaptureQueueOptions
): Promise<DrainCaptureQueueResult> {
	let processed = 0;
	let stoppedForOffline = false;

	while (!options?.signal?.aborted) {
		const pending = await listCaptureQueueItems();
		const processingId = pending.find((i) => i.status === 'processing')?.id ?? null;
		options?.broadcast?.({
			type: 'snapshot',
			pending: pending.filter((i) => i.status === 'pending').length,
			processingId
		});

		const item = await getNextPendingCaptureItem();
		if (!item) {
			options?.broadcast?.({ type: 'idle' });
			break;
		}

		options?.broadcast?.({ type: 'active', id: item.id, raw: item.raw });

		const result = await processCaptureQueueItem(item, {
			signal: options?.signal,
			streamProgress: options?.streamProgress,
			onProgress: (event) => {
				options?.onProgress?.(item.id, event);
				options?.broadcast?.({ type: 'progress', id: item.id, event });
			}
		});

		if (result.outcome === 'done') {
			processed += 1;
			options?.broadcast?.({
				type: 'done',
				id: item.id,
				thought: result.thought as CaptureSubmitResult
			});
			continue;
		}

		if (result.outcome === 'offline') {
			stoppedForOffline = true;
			await registerCaptureQueueBackgroundSync();
			options?.broadcast?.({ type: 'idle' });
			break;
		}

		if (result.outcome === 'retry') {
			continue;
		}

		if (result.outcome === 'failed') {
			options?.broadcast?.({ type: 'failed', id: item.id, error: result.error });
		}
	}

	return { processed, stoppedForOffline };
}
