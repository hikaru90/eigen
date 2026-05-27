import {
	CAPTURE_QUEUE_DB_NAME,
	CAPTURE_QUEUE_DB_VERSION,
	CAPTURE_QUEUE_DRAIN_LOCK_ID,
	CAPTURE_QUEUE_STORE,
	MAX_BACKGROUND_CAPTURE_ATTEMPTS,
	type CaptureQueueItem,
	type CaptureQueueStatus
} from './types';

const CAPTURE_QUEUE_DRAIN_LOCK_TTL_MS = 120_000;

type CaptureQueueDrainLockRow = {
	id: typeof CAPTURE_QUEUE_DRAIN_LOCK_ID;
	holderId: string;
	expiresAt: number;
};

function isQueueItem(row: unknown): row is CaptureQueueItem {
	return (
		typeof row === 'object' &&
		row !== null &&
		'id' in row &&
		(row as { id: string }).id !== CAPTURE_QUEUE_DRAIN_LOCK_ID &&
		'raw' in row &&
		'status' in row
	);
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
	});
}

function transactionDone(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
		tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
	});
}

export function openCaptureQueueDb(): Promise<IDBDatabase> {
	if (typeof indexedDB === 'undefined') {
		return Promise.reject(new Error('IndexedDB is not available'));
	}
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(CAPTURE_QUEUE_DB_NAME, CAPTURE_QUEUE_DB_VERSION);
		req.onerror = () => reject(req.error ?? new Error('Failed to open capture queue database'));
		req.onsuccess = () => resolve(req.result);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(CAPTURE_QUEUE_STORE)) {
				const store = db.createObjectStore(CAPTURE_QUEUE_STORE, { keyPath: 'id' });
				store.createIndex('status', 'status', { unique: false });
				store.createIndex('createdAt', 'createdAt', { unique: false });
			}
		};
	});
}

export async function listCaptureQueueItems(): Promise<CaptureQueueItem[]> {
	const db = await openCaptureQueueDb();
	try {
		const tx = db.transaction(CAPTURE_QUEUE_STORE, 'readonly');
		const store = tx.objectStore(CAPTURE_QUEUE_STORE);
		const items = await requestToPromise(store.getAll());
		await transactionDone(tx);
		return (items as unknown[])
			.filter(isQueueItem)
			.sort((a, b) => a.createdAt - b.createdAt);
	} finally {
		db.close();
	}
}

export async function putCaptureQueueItem(item: CaptureQueueItem): Promise<void> {
	const db = await openCaptureQueueDb();
	try {
		const tx = db.transaction(CAPTURE_QUEUE_STORE, 'readwrite');
		tx.objectStore(CAPTURE_QUEUE_STORE).put(item);
		await transactionDone(tx);
	} finally {
		db.close();
	}
}

export async function deleteCaptureQueueItem(id: string): Promise<void> {
	const db = await openCaptureQueueDb();
	try {
		const tx = db.transaction(CAPTURE_QUEUE_STORE, 'readwrite');
		tx.objectStore(CAPTURE_QUEUE_STORE).delete(id);
		await transactionDone(tx);
	} finally {
		db.close();
	}
}

export async function updateCaptureQueueItem(
	id: string,
	patch: Partial<Pick<CaptureQueueItem, 'status' | 'attempts' | 'lastError'>>
): Promise<CaptureQueueItem | null> {
	const db = await openCaptureQueueDb();
	try {
		const tx = db.transaction(CAPTURE_QUEUE_STORE, 'readwrite');
		const store = tx.objectStore(CAPTURE_QUEUE_STORE);
		const existing = (await requestToPromise(store.get(id))) as CaptureQueueItem | undefined;
		if (!existing) {
			await transactionDone(tx);
			return null;
		}
		const next: CaptureQueueItem = { ...existing, ...patch };
		store.put(next);
		await transactionDone(tx);
		return next;
	} finally {
		db.close();
	}
}

export async function getNextPendingCaptureItem(): Promise<CaptureQueueItem | null> {
	const items = await listCaptureQueueItems();
	return items.find((i) => i.status === 'pending') ?? null;
}

export async function enqueueCaptureRaw(raw: string, id = crypto.randomUUID()): Promise<CaptureQueueItem> {
	const trimmed = raw.trim();
	if (!trimmed) throw new Error('raw is required');
	const item: CaptureQueueItem = {
		id,
		raw: trimmed,
		createdAt: Date.now(),
		status: 'pending',
		attempts: 0
	};
	await putCaptureQueueItem(item);
	return item;
}

export async function setCaptureQueueStatus(
	id: string,
	status: CaptureQueueStatus,
	extra?: Partial<Pick<CaptureQueueItem, 'attempts' | 'lastError'>>
): Promise<CaptureQueueItem | null> {
	return updateCaptureQueueItem(id, { status, ...extra });
}

/** Single-flight drain across tabs and the service worker. */
export async function tryAcquireCaptureQueueDrainLock(holderId: string): Promise<boolean> {
	const db = await openCaptureQueueDb();
	const now = Date.now();
	try {
		const tx = db.transaction(CAPTURE_QUEUE_STORE, 'readwrite');
		const store = tx.objectStore(CAPTURE_QUEUE_STORE);
		const existing = (await requestToPromise(store.get(CAPTURE_QUEUE_DRAIN_LOCK_ID))) as
			| CaptureQueueDrainLockRow
			| undefined;
		if (existing && existing.expiresAt > now && existing.holderId !== holderId) {
			await transactionDone(tx);
			return false;
		}
		const lock: CaptureQueueDrainLockRow = {
			id: CAPTURE_QUEUE_DRAIN_LOCK_ID,
			holderId,
			expiresAt: now + CAPTURE_QUEUE_DRAIN_LOCK_TTL_MS
		};
		store.put(lock);
		await transactionDone(tx);
		return true;
	} finally {
		db.close();
	}
}

export async function releaseCaptureQueueDrainLock(holderId: string): Promise<void> {
	const db = await openCaptureQueueDb();
	try {
		const tx = db.transaction(CAPTURE_QUEUE_STORE, 'readwrite');
		const store = tx.objectStore(CAPTURE_QUEUE_STORE);
		const existing = (await requestToPromise(store.get(CAPTURE_QUEUE_DRAIN_LOCK_ID))) as
			| CaptureQueueDrainLockRow
			| undefined;
		if (existing?.holderId === holderId) {
			store.delete(CAPTURE_QUEUE_DRAIN_LOCK_ID);
		}
		await transactionDone(tx);
	} finally {
		db.close();
	}
}

/** Requeue items left in `processing` after a tab crash or reload. */
export async function recoverStuckProcessingCaptureItems(): Promise<number> {
	const items = await listCaptureQueueItems();
	let recovered = 0;
	for (const item of items) {
		if (item.status !== 'processing') continue;
		const attempts = item.attempts + 1;
		if (attempts >= MAX_BACKGROUND_CAPTURE_ATTEMPTS) {
			await updateCaptureQueueItem(item.id, {
				status: 'failed',
				attempts,
				lastError: 'Capture interrupted before completion (reload or tab closed)'
			});
		} else {
			await setCaptureQueueStatus(item.id, 'pending', { attempts });
		}
		recovered += 1;
	}
	return recovered;
}
