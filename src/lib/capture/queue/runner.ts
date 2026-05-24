import { enqueueCaptureRaw, listCaptureQueueItems } from './db';
import { drainCaptureQueue } from './drain';
import { registerCaptureQueueBackgroundSync } from './sync-registration';
import {
	CAPTURE_QUEUE_CHANNEL,
	type CaptureQueueBroadcast,
	type CaptureQueueItem,
	type CaptureSubmitResult
} from './types';
import type { ProgressEvent } from '$lib/capture/consume-capture-ndjson';

type RunnerListener = (message: CaptureQueueBroadcast) => void;

let started = false;
let draining = false;
let activeAbort: AbortController | null = null;
const listeners = new Set<RunnerListener>();
let channel: BroadcastChannel | null = null;

function emit(message: CaptureQueueBroadcast) {
	for (const listener of listeners) listener(message);
	if (channel) channel.postMessage(message);
}

function ensureChannel() {
	if (typeof BroadcastChannel === 'undefined') return;
	if (!channel) {
		channel = new BroadcastChannel(CAPTURE_QUEUE_CHANNEL);
		channel.onmessage = (event: MessageEvent<CaptureQueueBroadcast>) => {
			emit(event.data);
		};
	}
}

export function subscribeCaptureQueue(listener: RunnerListener): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export async function getCaptureQueueSnapshot(): Promise<{
	items: CaptureQueueItem[];
	pending: number;
	processingId: string | null;
}> {
	const items = await listCaptureQueueItems();
	const processingId = items.find((i) => i.status === 'processing')?.id ?? null;
	return {
		items,
		pending: items.filter((i) => i.status === 'pending').length,
		processingId
	};
}

async function kickDrain() {
	if (draining) return;
	draining = true;
	const ac = new AbortController();
	activeAbort = ac;
	try {
		await drainCaptureQueue({
			signal: ac.signal,
			streamProgress: true,
			broadcast: emit,
			onProgress: (id, event) => emit({ type: 'progress', id, event })
		});
	} finally {
		draining = false;
		if (activeAbort === ac) activeAbort = null;
	}
}

export async function enqueueCapture(raw: string): Promise<CaptureQueueItem> {
	const item = await enqueueCaptureRaw(raw);
	emit({
		type: 'snapshot',
		pending: (await listCaptureQueueItems()).filter((i) => i.status === 'pending').length,
		processingId: null
	});
	if (typeof navigator !== 'undefined' && !navigator.onLine) {
		await registerCaptureQueueBackgroundSync();
	} else {
		void kickDrain();
	}
	return item;
}

export function cancelActiveCapture(): void {
	activeAbort?.abort();
	activeAbort = null;
}

export function startCaptureQueueRunner(): void {
	if (started || typeof window === 'undefined') return;
	started = true;
	ensureChannel();

	const onOnline = () => {
		void kickDrain();
	};
	window.addEventListener('online', onOnline);

	if ('serviceWorker' in navigator) {
		navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
			const data = event.data;
			if (data && typeof data === 'object' && 'type' in data) {
				emit(data as CaptureQueueBroadcast);
			}
			if (
				data &&
				typeof data === 'object' &&
				'type' in data &&
				(data as { type?: string }).type === 'capture-queue-idle'
			) {
				void kickDrain();
			}
		});
	}

	void (async () => {
		const snap = await getCaptureQueueSnapshot();
		if (snap.pending > 0 || snap.processingId) {
			emit({
				type: 'snapshot',
				pending: snap.pending,
				processingId: snap.processingId
			});
			void kickDrain();
		}
	})();
}

export type { CaptureSubmitResult, ProgressEvent };
