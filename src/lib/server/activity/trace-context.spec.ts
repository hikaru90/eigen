import { describe, expect, it } from 'vitest';
import { getCurrentTraceGroupId, runWithTrace } from './trace-context';

describe('trace-context', () => {
	it('stores and reads the current trace group id within runWithTrace', async () => {
		await runWithTrace('group-123', async () => {
			expect(getCurrentTraceGroupId()).toBe('group-123');
		});
		expect(getCurrentTraceGroupId()).toBeUndefined();
	});
});
