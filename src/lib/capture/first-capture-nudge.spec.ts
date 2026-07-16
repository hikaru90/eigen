import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
	firstCaptureNudgeDismissKey,
	isFirstCaptureNudgeDismissed
} from './first-capture-nudge';

describe('first-capture-nudge', () => {
	const store = new Map<string, string>();

	beforeEach(() => {
		store.clear();
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => {
				store.set(key, value);
			},
			removeItem: (key: string) => {
				store.delete(key);
			}
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('builds a stable dismiss key per user', () => {
		expect(firstCaptureNudgeDismissKey('u1')).toBe('eigenmesh:first_capture_nudge_dismissed:u1');
	});

	it('reports dismissed only after localStorage flag is set', () => {
		expect(isFirstCaptureNudgeDismissed('u1')).toBe(false);
		localStorage.setItem(firstCaptureNudgeDismissKey('u1'), '1');
		expect(isFirstCaptureNudgeDismissed('u1')).toBe(true);
	});
});
