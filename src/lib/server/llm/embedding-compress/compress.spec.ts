import { describe, expect, it } from 'vitest';
import { compress } from './compress';

describe('embedding-compress (vendored cavemem-style)', () => {
	it('preserves https URL text', () => {
		const s = 'see https://example.com/path?q=1 for docs';
		const out = compress(s, { intensity: 'full' });
		expect(out).toContain('https://example.com/path?q=1');
	});

	it('accepts lite and ultra intensities', () => {
		const s = 'I think that basically it is very good.';
		const lite = compress(s, { intensity: 'lite' });
		const ultra = compress(s, { intensity: 'ultra' });
		expect(ultra.length).toBeLessThanOrEqual(lite.length);
	});
});
