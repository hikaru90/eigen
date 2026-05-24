import { CAPTURE_QUEUE_SYNC_TAG } from './types';

export async function registerCaptureQueueBackgroundSync(): Promise<void> {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
	const registration = await navigator.serviceWorker.ready;
	if (!('sync' in registration)) return;
	try {
		await (
			registration as ServiceWorkerRegistration & {
				sync: { register: (tag: string) => Promise<void> };
			}
		).sync.register(CAPTURE_QUEUE_SYNC_TAG);
	} catch {
		/* Background Sync unsupported or registration failed */
	}
}
