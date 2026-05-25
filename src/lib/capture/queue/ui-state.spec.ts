import { describe, expect, it } from 'vitest';
import {
	applyCaptureQueueActive,
	applyCaptureQueueSnapshot,
	CAPTURE_QUEUE_ACTIVATION_GUARD_MS,
	initialCaptureQueueUiState,
	shouldAcceptCaptureProgress
} from './ui-state';

describe('capture queue ui-state', () => {
	it('applies snapshot with processing id', () => {
		const state = initialCaptureQueueUiState();
		const next = applyCaptureQueueSnapshot(state, { pending: 2, processingId: 'a' });
		expect(next.activeCaptureId).toBe('a');
		expect(next.pendingCount).toBe(2);
		expect(next.recentlyActivatedId).toBeNull();
	});

	it('ignores stale snapshot that clears recent activation', () => {
		const t0 = 1_000;
		let state = applyCaptureQueueActive(initialCaptureQueueUiState(), 'cap-1', t0);
		const next = applyCaptureQueueSnapshot(
			state,
			{ pending: 1, processingId: null },
			t0 + CAPTURE_QUEUE_ACTIVATION_GUARD_MS - 1
		);
		expect(next.activeCaptureId).toBe('cap-1');
		expect(next.pendingCount).toBe(1);
	});

	it('allows stale snapshot to clear activation after guard window', () => {
		const t0 = 1_000;
		let state = applyCaptureQueueActive(initialCaptureQueueUiState(), 'cap-1', t0);
		const next = applyCaptureQueueSnapshot(
			state,
			{ pending: 1, processingId: null },
			t0 + CAPTURE_QUEUE_ACTIVATION_GUARD_MS + 1
		);
		expect(next.activeCaptureId).toBeNull();
	});

	it('accepts progress during activation guard when active id was cleared', () => {
		const t0 = 2_000;
		let state = applyCaptureQueueActive(initialCaptureQueueUiState(), 'cap-2', t0);
		state = applyCaptureQueueSnapshot(state, { pending: 0, processingId: null }, t0 + 100);
		state = { ...state, activeCaptureId: null };
		expect(shouldAcceptCaptureProgress(state, 'cap-2', t0 + 200)).toBe(true);
	});
});
