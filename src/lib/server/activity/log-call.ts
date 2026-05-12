import { activityCallLog } from '$lib/server/db/schema';
import type { AppDatabase } from '$lib/server/db/context';
import { priceCall } from '$lib/server/pricing';
import { getCurrentTraceGroupId } from './trace-context';

export async function logActivityCall(
	db: AppDatabase,
	userId: string,
	input: {
		provider: string;
		operation: string;
		baseCostUsd: number;
		groupId?: string;
		durationMs?: number;
	}
): Promise<void> {
	const priced = priceCall(input.baseCostUsd);
	await db.insert(activityCallLog).values({
		userId,
		provider: input.provider,
		operation: input.operation,
		baseCostUsd: priced.baseCostUsd,
		markupUsd: priced.markupUsd,
		totalCostUsd: priced.totalCostUsd,
		markupRate: priced.markupRate,
		groupId: input.groupId ?? getCurrentTraceGroupId(),
		durationMs: input.durationMs
	});
}
