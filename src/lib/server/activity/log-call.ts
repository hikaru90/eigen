import { isUuidV4 } from '$lib/random-uuid';
import { activityCallLog } from '$lib/server/db/schema';
import type { AppDatabase } from '$lib/server/db/context';
import { resolveTenantUserId } from '$lib/server/billing/context';
import { priceCall } from '$lib/server/pricing';
import { getCurrentTraceGroupId } from './trace-context';

/** activity_call_log.group_id is uuid — non-UUID trace ids must not fail the caller. */
function resolveActivityGroupId(explicit?: string): string | undefined {
	const candidate = explicit?.trim() || getCurrentTraceGroupId()?.trim();
	if (!candidate) return undefined;
	return isUuidV4(candidate) ? candidate : undefined;
}

export async function logActivityCall(
	db: AppDatabase,
	userId: string,
	input: {
		provider: string;
		operation: string;
		baseCostUsd: number;
		/** Hostname derived from the gateway base URL (billable LLM calls only). */
		gatewayHost?: string | null;
		context?: string;
		groupId?: string;
		durationMs?: number;
	}
): Promise<void> {
	const priced = priceCall(input.baseCostUsd);
	// Truncate context to 100 chars max for storage
	const context = input.context?.trim()
		? (input.context.length > 100 ? input.context.slice(0, 97) + '...' : input.context)
		: null;
	const logUserId = resolveTenantUserId(userId);
	await db.insert(activityCallLog).values({
		userId: logUserId,
		provider: input.provider,
		gatewayHost: input.gatewayHost?.trim() ? input.gatewayHost.trim().toLowerCase() : null,
		operation: input.operation,
		context,
		baseCostUsd: priced.baseCostUsd,
		markupUsd: priced.markupUsd,
		totalCostUsd: priced.totalCostUsd,
		markupRate: priced.markupRate,
		groupId: resolveActivityGroupId(input.groupId),
		durationMs: input.durationMs
	});
}
