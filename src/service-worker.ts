/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.addEventListener('install', (event) => {
	event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
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
