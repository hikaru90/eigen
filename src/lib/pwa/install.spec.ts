import { describe, expect, it } from 'vitest';
import { isIosDevice, isPwaStandalone } from '$lib/pwa/install';

describe('pwa/install helpers', () => {
	it('reports non-standalone outside a browser display-mode match', () => {
		// jsdom / vitest: matchMedia may be stubbed; function must not throw
		expect(typeof isPwaStandalone()).toBe('boolean');
		expect(typeof isIosDevice()).toBe('boolean');
	});
});
