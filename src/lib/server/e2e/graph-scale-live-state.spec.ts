import { describe, expect, it } from 'vitest';
import { initialGraphScaleLiveState } from './graph-scale-live-state';

describe('initialGraphScaleLiveState', () => {
	it('starts in starting status with empty metrics', () => {
		const state = initialGraphScaleLiveState({ runId: 'run-1', label: 'boot' });
		expect(state.runId).toBe('run-1');
		expect(state.status).toBe('starting');
		expect(state.corpusUserId).toBeNull();
		expect(state.graph).toEqual({
			thoughts: 0,
			entities: 0,
			edges: 0,
			communities: 0,
			projects: 0
		});
		expect(state.label).toBe('boot');
	});
});
