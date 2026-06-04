import { describe, expect, it } from 'vitest';
import { InsufficientCreditsError } from './wallet';

describe('InsufficientCreditsError', () => {
	it('includes available and required amounts in the message', () => {
		const err = new InsufficientCreditsError({
			phase: 'precheck',
			availableCredits: 100,
			requiredCredits: 500
		});
		expect(err.message).toContain('100 credits');
		expect(err.message).toContain('500 credits');
		expect(err.availableCredits).toBe(100);
		expect(err.requiredCredits).toBe(500);
		expect(err.phase).toBe('precheck');
	});

	it('includes gateway cost hint on settle failures', () => {
		const err = new InsufficientCreditsError({
			phase: 'settle',
			availableCredits: 50,
			requiredCredits: 200,
			baseUsd: 1.5
		});
		expect(err.message).toContain('$1.5000');
		expect(err.phase).toBe('settle');
	});
});
