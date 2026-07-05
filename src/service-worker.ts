/// <reference lib="webworker" />
import { drainCaptureQueue } from '$lib/capture/queue/drain';
import {
	releaseCaptureQueueDrainLock,
	tryAcquireCaptureQueueDrainLock
} from '$lib/capture/queue/db';
import { CAPTURE_QUEUE_SYNC_TAG, type CaptureQueueBroadcast } from '$lib/capture/queue/types';

const SW_DRAIN_LOCK_HOLDER = 'service-worker';

declare const self: ServiceWorkerGlobalScope;

async function broadcastCaptureQueueMessage(message: CaptureQueueBroadcast | { type: 'capture-queue-idle' }) {
	const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
	for (const client of clients) {
		client.postMessage(message);
	}
}

async function requestPageDrain(): Promise<void> {
	const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
	for (const client of clients) {
		client.postMessage({ type: 'DRAIN_CAPTURE_QUEUE' });
	}
}

async function drainCaptureQueueInBackground(): Promise<void> {
	const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
	const hasVisibleClient = clients.some(
		(c) => 'visibilityState' in c && c.visibilityState === 'visible'
	);
	if (hasVisibleClient) {
		await requestPageDrain();
		return;
	}

	if (!(await tryAcquireCaptureQueueDrainLock(SW_DRAIN_LOCK_HOLDER))) {
		await requestPageDrain();
		return;
	}

	try {
		await drainCaptureQueue({
			streamProgress: false,
			broadcast: (message) => broadcastCaptureQueueMessage(message)
		});
		await broadcastCaptureQueueMessage({ type: 'capture-queue-idle' });
	} finally {
		await releaseCaptureQueueDrainLock(SW_DRAIN_LOCK_HOLDER);
	}
}

self.addEventListener('install', (event) => {
	event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener('sync', (event) => {
	const syncEvent = event as SyncEvent;
	if (syncEvent.tag !== CAPTURE_QUEUE_SYNC_TAG) return;
	syncEvent.waitUntil(drainCaptureQueueInBackground());
});

self.addEventListener('message', (event) => {
	const data = event.data;
	if (data && typeof data === 'object' && 'type' in data && (data as { type: string }).type === 'DRAIN_CAPTURE_QUEUE') {
		event.waitUntil(drainCaptureQueueInBackground());
	}
});

type PushPayload = {
	title?: string;
	body?: string;
	url?: string;
	tag?: string;
};

function parsePushPayload(event: PushEvent): PushPayload {
	if (!event.data) return {};
	try {
		const json = event.data.json() as unknown;
		if (json && typeof json === 'object') return json as PushPayload;
	} catch {
		const text = event.data.text();
		if (text.trim()) return { body: text };
	}
	return {};
}

self.addEventListener('push', (event) => {
	const payload = parsePushPayload(event);
	const title = typeof payload.title === 'string' && payload.title.trim() ? payload.title : 'Eigen';
	const body =
		typeof payload.body === 'string' && payload.body.trim()
			? payload.body
			: 'You have a new notification.';
	const tag = typeof payload.tag === 'string' && payload.tag.trim() ? payload.tag : 'eigen-push';
	const url = typeof payload.url === 'string' && payload.url.trim() ? payload.url : '/';

	event.waitUntil(
		self.registration.showNotification(title, {
			body,
			tag,
			data: { url },
			icon: '/pwa-192.png',
			badge: '/pwa-192.png'
		})
	);
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url =
		event.notification.data &&
		typeof event.notification.data === 'object' &&
		'url' in event.notification.data &&
		typeof (event.notification.data as { url?: unknown }).url === 'string'
			? (event.notification.data as { url: string }).url
			: '/';

	event.waitUntil(
		self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
			for (const client of clients) {
				if ('focus' in client && client.url.includes(self.location.origin)) {
					return client.focus();
				}
			}
			return self.clients.openWindow(url);
		})
	);
});
