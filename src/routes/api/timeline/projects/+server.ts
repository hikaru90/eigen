import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listProjectsForUser, type ProjectListItem } from '$lib/server/memory/project-list';

export type TimelineProjectsResponse = {
	projects: ProjectListItem[];
};

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const projects = await listProjectsForUser(user.id);
	return json({ projects } satisfies TimelineProjectsResponse);
};
