import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Postgres RLS session user (`app.current_user_id`). Activity rows must use this id.
 */
export const tenantUserAsyncLocal = new AsyncLocalStorage<string>();

/**
 * When set (e.g. eval harness), platform LLM debits and credit checks use this user
 * instead of the tenant RLS user. Thought/memory rows still belong to the tenant user.
 */
export const billingUserAsyncLocal = new AsyncLocalStorage<string>();

export function resolveTenantUserId(fallbackUserId: string): string {
	return tenantUserAsyncLocal.getStore() ?? fallbackUserId;
}

export function resolveBillingUserId(tenantUserId: string): string {
	return billingUserAsyncLocal.getStore() ?? tenantUserId;
}
