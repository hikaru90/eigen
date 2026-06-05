import { describe, expect, it, vi } from 'vitest';
import { createPhaseTimer, logRetrievalPhaseTiming } from './phase-timing';

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

	it('logRetrievalPhaseTiming uses default tag when tag is omitted', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => {});
		const timing = { phases: [{ phase: 'embed' as const, ms: 12 }], totalMs: 12 };

		logRetrievalPhaseTiming({
			userId: 'u1',
			query: 'hello',
			mode: 'fast',
			topK: 5,
			timing
		});

		expect(info).toHaveBeenCalledWith('[retrieval.searchThoughts]', expect.any(Object));
		info.mockRestore();
	});

	it('logRetrievalPhaseTiming uses custom tag when provided', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => {});
		const timing = { phases: [{ phase: 'vector' as const, ms: 3 }], totalMs: 3 };

		logRetrievalPhaseTiming({
			userId: 'u1',
			query: 'hello',
			mode: 'full',
			topK: 10,
			timing,
			tag: '[retrieval.custom]'
		});

		expect(info).toHaveBeenCalledWith('[retrieval.custom]', expect.any(Object));
		info.mockRestore();
	});
});
