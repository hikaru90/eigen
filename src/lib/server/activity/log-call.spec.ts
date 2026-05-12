import { describe, expect, it, vi } from 'vitest';
import { logActivityCall } from './log-call';

vi.mock('$lib/server/pricing', () => ({
	priceCall: vi.fn((base: number) => ({
		baseCostUsd: base.toFixed(6),
		markupUsd: (base * 0.2).toFixed(6),
		totalCostUsd: (base * 1.2).toFixed(6),
		markupRate: '0.200000'
	}))
}));

vi.mock('./trace-context', () => ({
	getCurrentTraceGroupId: vi.fn(() => undefined)
}));

describe('logActivityCall', () => {
	it('persists priced activity fields', async () => {
		const values = vi.fn();
		const insert = vi.fn(() => ({ values }));
		const db = { insert } as unknown as Parameters<typeof logActivityCall>[0];

		await logActivityCall(db, 'u1', {
			provider: 'llm',
			operation: 'embedding',
			baseCostUsd: 1
		});

		expect(insert).toHaveBeenCalledTimes(1);
		expect(values).toHaveBeenCalledWith({
			userId: 'u1',
			provider: 'llm',
			operation: 'embedding',
			baseCostUsd: '1.000000',
			markupUsd: '0.200000',
			totalCostUsd: '1.200000',
			markupRate: '0.200000',
			groupId: undefined,
			durationMs: undefined
		});
	});

	it('forwards groupId and durationMs when provided', async () => {
		const values = vi.fn();
		const insert = vi.fn(() => ({ values }));
		const db = { insert } as unknown as Parameters<typeof logActivityCall>[0];

		await logActivityCall(db, 'u1', {
			provider: 'agent',
			operation: 'tool_call.retrieve_thoughts',
			baseCostUsd: 0,
			groupId: 'g1',
			durationMs: 342
		});

		expect(values).toHaveBeenCalledWith(
			expect.objectContaining({ groupId: 'g1', durationMs: 342 })
		);
	});
});
