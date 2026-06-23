import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	notifyThoughtChanged,
	notifyThoughtRefreshAll,
	startThoughtSync,
	subscribeThoughtSync,
	THOUGHT_SYNC_CHANNEL
} from './thought-sync';

describe('thought-sync', () => {
	beforeEach(() => {
		vi.stubGlobal('BroadcastChannel', undefined);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('notifies in-tab subscribers when a thought changes', () => {
		const listener = vi.fn();
		const unsubscribe = subscribeThoughtSync(listener);

		notifyThoughtChanged('thought-1', 'lifecycle', 'local');

		expect(listener).toHaveBeenCalledWith({
			type: 'changed',
			thoughtId: 'thought-1',
			change: 'lifecycle',
			scope: 'local'
		});

		unsubscribe();
	});

	it('notifies subscribers on refresh-all', () => {
		const listener = vi.fn();
		const unsubscribe = subscribeThoughtSync(listener);

		notifyThoughtRefreshAll('manual', 'local');

		expect(listener).toHaveBeenCalledWith({
			type: 'refresh-all',
			source: 'manual',
			scope: 'local'
		});

		unsubscribe();
	});

	it('uses a stable broadcast channel name', () => {
		expect(THOUGHT_SYNC_CHANNEL).toBe('eigen-thought-sync');
	});

	it('startThoughtSync refreshes subscribers when the tab becomes visible', () => {
		let visibilityState: DocumentVisibilityState = 'hidden';
		const listeners: Record<string, EventListener> = {};

		vi.stubGlobal('window', {});
		vi.stubGlobal('document', {
			get visibilityState() {
				return visibilityState;
			},
			addEventListener(type: string, listener: EventListener) {
				listeners[type] = listener;
			}
		});

		const listener = vi.fn();
		subscribeThoughtSync(listener);
		startThoughtSync();

		visibilityState = 'visible';
		listeners.visibilitychange?.(new Event('visibilitychange'));

		expect(listener).toHaveBeenCalledWith({
			type: 'refresh-all',
			source: 'visibility',
			scope: 'local'
		});
	});
});
