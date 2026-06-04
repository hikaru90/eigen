import { describe, expect, it } from 'vitest';
import { InsufficientCreditsError } from './wallet';

describe('InsufficientCreditsError', () => {
	it('includes available and required amounts in the message', () => {
		const err = new InsufficientCreditsError({
			phase: 'precheck',
			availableCents: 100,
			requiredCents: 500,
			currency: 'EUR'
		});
		expect(err.message).toContain('1.00 EUR');
		expect(err.message).toContain('5.00 EUR');
		expect(err.availableCents).toBe(100);
		expect(err.requiredCents).toBe(500);
		expect(err.phase).toBe('precheck');
	});

	it('includes gateway cost hint on settle failures', () => {
		const err = new InsufficientCreditsError({
			phase: 'settle',
			availableCents: 50,
			requiredCents: 200,
			currency: 'USD',
			baseUsd: 1.5
		});
		expect(err.message).toContain('$1.5000');
		expect(err.phase).toBe('settle');
	});
});
