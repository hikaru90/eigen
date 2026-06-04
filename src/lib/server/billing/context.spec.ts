import { describe, expect, it, vi } from 'vitest';
import { billingUserAsyncLocal, resolveBillingUserId } from './context';

describe('billing context', () => {
	it('resolveBillingUserId returns tenant id when no override', () => {
		expect(resolveBillingUserId('tenant-a')).toBe('tenant-a');
	});

	it('resolveBillingUserId uses async local override', async () => {
		await billingUserAsyncLocal.run('operator-1', async () => {
			expect(resolveBillingUserId('eval-abc')).toBe('operator-1');
		});
		expect(resolveBillingUserId('eval-abc')).toBe('eval-abc');
	});
});
