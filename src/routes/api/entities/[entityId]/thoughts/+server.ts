import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listThoughtsMentioningCanonicalEntity } from '$lib/server/memory/canonical-entity-admin';

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const entityId = event.params.entityId?.trim() ?? '';
	if (!entityId) error(400, 'entityId is required');

	const rows = await listThoughtsMentioningCanonicalEntity(user.id, entityId);
	return json({ thoughts: rows });
};
