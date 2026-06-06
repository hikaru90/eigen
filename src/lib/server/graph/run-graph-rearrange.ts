import { checkEntityGraphConnectionsForUser } from '$lib/server/consolidation/check-entity-graph-connections';
import { pruneDuplicateThoughtRelationEdgesForUser } from '$lib/server/consolidation/prune-duplicate-thought-relation-edges';
import { pruneOrphanEntityNodesForUser } from '$lib/server/consolidation/prune-orphan-entity-nodes';
import { pruneOrphanThoughtNodesForUser } from '$lib/server/consolidation/prune-orphan-thought-nodes';
import { pruneSuspiciousEntityEdgesForUser } from '$lib/server/consolidation/prune-suspicious-entity-edges';
import { repairEntityRelationsForUser } from '$lib/server/consolidation/repair-entity-relations';
import type { GraphRearrangePhase } from '$lib/graph/graph-rearrange-phases';

export type GraphRearrangeRunResult = {
	pruned: Awaited<ReturnType<typeof pruneSuspiciousEntityEdgesForUser>>;
	orphanThoughts: Awaited<ReturnType<typeof pruneOrphanThoughtNodesForUser>>;
	orphanEntities: Awaited<ReturnType<typeof pruneOrphanEntityNodesForUser>>;
	duplicatePruned: Awaited<ReturnType<typeof pruneDuplicateThoughtRelationEdgesForUser>>;
	connections: Awaited<ReturnType<typeof checkEntityGraphConnectionsForUser>>;
	repaired: Awaited<ReturnType<typeof repairEntityRelationsForUser>>;
};

export async function runGraphRearrangeForUser(
	userId: string,
	onProgress?: (phase: GraphRearrangePhase) => void | Promise<void>
): Promise<GraphRearrangeRunResult> {
	await onProgress?.('prune_weak_edges');
	const pruned = await pruneSuspiciousEntityEdgesForUser(userId);

	await onProgress?.('prune_orphan_thoughts');
	const orphanThoughts = await pruneOrphanThoughtNodesForUser(userId);

	await onProgress?.('prune_orphan_entities');
	const orphanEntities = await pruneOrphanEntityNodesForUser(userId);

	await onProgress?.('prune_duplicate_edges');
	const duplicatePruned = await pruneDuplicateThoughtRelationEdgesForUser(userId);

	await onProgress?.('check_connections');
	const connections = await checkEntityGraphConnectionsForUser(userId);

	await onProgress?.('repair_relations');
	const repaired = await repairEntityRelationsForUser(userId);

	return { pruned, orphanThoughts, orphanEntities, duplicatePruned, connections, repaired };
}
