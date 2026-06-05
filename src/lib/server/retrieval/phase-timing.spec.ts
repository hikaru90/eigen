import { describe, expect, it } from 'vitest';
import { createPhaseTimer } from './phase-timing';

describe('phase-timing', () => {
	it('records phase marks and total duration', () => {
		const timer = createPhaseTimer();
		timer.mark('embed');
		timer.mark('vector');
		const timing = timer.finish();
		expect(timing.totalMs).toBeGreaterThanOrEqual(0);
		expect(timing.phases.map((p) => p.phase)).toEqual(
			expect.arrayContaining(['embed', 'vector'])
		);
		for (const entry of timing.phases) {
			expect(entry.ms).toBeGreaterThanOrEqual(0);
		}
	});
});
