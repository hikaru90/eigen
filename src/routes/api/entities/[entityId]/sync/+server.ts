import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { syncCanonicalEntityVertexToGraph } from '$lib/server/memory/canonical-entity-admin';

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const entityId = event.params.entityId?.trim() ?? '';
	if (!entityId) error(400, 'entityId is required');

	const result = await syncCanonicalEntityVertexToGraph(user.id, entityId);
	if (!result.ok) error(404, 'Entity not found');

	return json({ ok: true as const });
};
