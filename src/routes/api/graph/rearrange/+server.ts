/**
 * POST /api/graph/rearrange
 *
 * Repairs entity relation edges and prunes unsupported links for the signed-in user's graph.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkEntityGraphConnectionsForUser } from '$lib/server/consolidation/check-entity-graph-connections';
import { pruneDuplicateThoughtRelationEdgesForUser } from '$lib/server/consolidation/prune-duplicate-thought-relation-edges';
import { pruneSuspiciousEntityEdgesForUser } from '$lib/server/consolidation/prune-suspicious-entity-edges';
import { repairEntityRelationsForUser } from '$lib/server/consolidation/repair-entity-relations';

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const pruned = await pruneSuspiciousEntityEdgesForUser(user.id);
	const duplicatePruned = await pruneDuplicateThoughtRelationEdgesForUser(user.id);
	const connections = await checkEntityGraphConnectionsForUser(user.id);
	const repaired = await repairEntityRelationsForUser(user.id);

	return json({
		ok: true as const,
		pruned,
		duplicatePruned,
		connections,
		repaired
	});
};
