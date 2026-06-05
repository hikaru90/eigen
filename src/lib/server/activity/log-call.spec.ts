import { describe, expect, it, vi } from 'vitest';
import { tenantUserAsyncLocal } from '$lib/server/billing/context';
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
			gatewayHost: null,
			operation: 'embedding',
			context: null,
			baseCostUsd: '1.000000',
			markupUsd: '0.200000',
			totalCostUsd: '1.200000',
			markupRate: '0.200000',
			groupId: undefined,
			durationMs: undefined
		});
	});

	it('uses tenant RLS user for user_id when tenant context is set', async () => {
		const values = vi.fn();
		const insert = vi.fn(() => ({ values }));
		const db = { insert } as unknown as Parameters<typeof logActivityCall>[0];

		await tenantUserAsyncLocal.run('eval-tenant-1', async () => {
			await logActivityCall(db, 'eval-runner-judge', {
				provider: 'eurouter',
				operation: 'llm.chat.success(attempt=1)',
				baseCostUsd: 0.000026
			});
		});

		expect(values).toHaveBeenCalledWith(expect.objectContaining({ userId: 'eval-tenant-1' }));
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

	it('truncates context longer than 100 chars', async () => {
		const values = vi.fn();
		const insert = vi.fn(() => ({ values }));
		const db = { insert } as unknown as Parameters<typeof logActivityCall>[0];
		const longContext = 'x'.repeat(101);

		await logActivityCall(db, 'u1', {
			provider: 'llm',
			operation: 'chat',
			baseCostUsd: 0,
			context: longContext
		});

		expect(values).toHaveBeenCalledWith(
			expect.objectContaining({ context: `${'x'.repeat(97)}...` })
		);
	});

	it('stores short context as-is and null for whitespace-only', async () => {
		const values = vi.fn();
		const insert = vi.fn(() => ({ values }));
		const db = { insert } as unknown as Parameters<typeof logActivityCall>[0];

		await logActivityCall(db, 'u1', {
			provider: 'llm',
			operation: 'chat',
			baseCostUsd: 0,
			context: '  hello  '
		});
		expect(values).toHaveBeenCalledWith(expect.objectContaining({ context: '  hello  ' }));

		values.mockClear();
		await logActivityCall(db, 'u1', {
			provider: 'llm',
			operation: 'chat',
			baseCostUsd: 0,
			context: '   \t\n  '
		});
		expect(values).toHaveBeenCalledWith(expect.objectContaining({ context: null }));
	});

	it('normalizes gatewayHost with trim and lowercase', async () => {
		const values = vi.fn();
		const insert = vi.fn(() => ({ values }));
		const db = { insert } as unknown as Parameters<typeof logActivityCall>[0];

		await logActivityCall(db, 'u1', {
			provider: 'llm',
			operation: 'chat',
			baseCostUsd: 0,
			gatewayHost: '  Gateway.Example.COM  '
		});
		expect(values).toHaveBeenCalledWith(
			expect.objectContaining({ gatewayHost: 'gateway.example.com' })
		);

		values.mockClear();
		await logActivityCall(db, 'u1', {
			provider: 'llm',
			operation: 'chat',
			baseCostUsd: 0,
			gatewayHost: '   '
		});
		expect(values).toHaveBeenCalledWith(expect.objectContaining({ gatewayHost: null }));
	});
});
