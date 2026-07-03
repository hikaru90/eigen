import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { updateProjectLabel } from '$lib/server/memory/project-list';

export type UpdateProjectRequest = {
	label: string;
};

export type UpdateProjectResponse = {
	entityId: string;
	label: string;
};

export const PUT: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const entityId = event.params.entityId?.trim();
	if (!entityId) error(400, 'Entity id is required');

	let body: UpdateProjectRequest;
	try {
		body = (await event.request.json()) as UpdateProjectRequest;
	} catch {
		error(400, 'Invalid JSON body');
	}

	const label = body.label?.trim();
	if (!label) error(400, 'label is required');

	try {
		const result = await updateProjectLabel(user.id, entityId, label);
		return json(result satisfies UpdateProjectResponse);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		error(400, message);
	}
};
