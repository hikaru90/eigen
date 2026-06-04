import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * When set (e.g. eval harness), platform LLM debits and credit checks use this user
 * instead of the tenant RLS user. Thought/memory rows still belong to the tenant user.
 */
export const billingUserAsyncLocal = new AsyncLocalStorage<string>();

export function resolveBillingUserId(tenantUserId: string): string {
	return billingUserAsyncLocal.getStore() ?? tenantUserId;
}
