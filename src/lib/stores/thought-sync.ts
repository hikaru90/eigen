export const THOUGHT_SYNC_CHANNEL = 'eigen-thought-sync';

export type ThoughtSyncScope = 'local' | 'global';

export type ThoughtSyncMessage =
	| { type: 'changed'; thoughtId: string; change: 'lifecycle' | 'edit' | 'delete'; scope: ThoughtSyncScope }
	| { type: 'refresh-all'; source: 'manual' | 'visibility'; scope: ThoughtSyncScope };

type ThoughtSyncListener = (message: ThoughtSyncMessage) => void;

type ThoughtSyncWire = ThoughtSyncMessage & { _origin?: string };

const listeners = new Set<ThoughtSyncListener>();
let channel: BroadcastChannel | null = null;
let started = false;
let visibilityHookInstalled = false;

const tabOrigin =
	typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? crypto.randomUUID()
		: `tab-${Math.random()}`;

function notifyListeners(message: ThoughtSyncMessage) {
	for (const listener of listeners) listener(message);
}

function deliver(message: ThoughtSyncMessage, scope: ThoughtSyncScope) {
	const payload = { ...message, scope } satisfies ThoughtSyncMessage;
	notifyListeners(payload);
	if (scope === 'global' && channel) {
		channel.postMessage({ ...payload, _origin: tabOrigin } satisfies ThoughtSyncWire);
	}
}

function ensureChannel() {
	if (typeof BroadcastChannel === 'undefined') return;
	if (channel) return;
	channel = new BroadcastChannel(THOUGHT_SYNC_CHANNEL);
	channel.onmessage = (event: MessageEvent<ThoughtSyncWire>) => {
		const data = event.data;
		if (!data || typeof data !== 'object' || !('type' in data)) return;
		if (data._origin === tabOrigin) return;
		const { _origin: _, ...message } = data;
		notifyListeners(message);
	};
}

/** Subscribe to thought changes across tabs and within the current tab. */
export function subscribeThoughtSync(listener: ThoughtSyncListener): () => void {
	ensureChannel();
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/**
 * Broadcast that a thought changed so every surface can refresh.
 * `local` notifies this tab only (e.g. timeline already updated its lists).
 * `global` also fans out to other tabs.
 */
export function notifyThoughtChanged(
	thoughtId: string,
	change: ThoughtSyncMessage & { type: 'changed' }['change'],
	scope: ThoughtSyncScope = 'global'
): void {
	ensureChannel();
	deliver({ type: 'changed', thoughtId, change, scope }, scope);
}

/** Ask subscribers to reload thought-backed data. */
export function notifyThoughtRefreshAll(
	source: 'manual' | 'visibility' = 'manual',
	scope: ThoughtSyncScope = 'global'
): void {
	ensureChannel();
	deliver({ type: 'refresh-all', source, scope }, scope);
}

/** Install cross-tab channel and refresh when the PWA returns to the foreground. */
export function startThoughtSync(): void {
	if (started || typeof window === 'undefined') return;
	started = true;
	ensureChannel();

	if (visibilityHookInstalled || typeof document === 'undefined') return;
	visibilityHookInstalled = true;

	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') {
			notifyThoughtRefreshAll('visibility', 'local');
		}
	});
}
