import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { ProjectStatus } from '$lib/server/db/schema';
import { createUserDeclaredProject } from '$lib/server/memory/create-user-project';
import { listProjectsForUser, type ProjectListItem } from '$lib/server/memory/project-list';

export type TimelineProjectsResponse = {
	projects: ProjectListItem[];
};

export type CreateProjectRequest = {
	label: string;
	status?: ProjectStatus;
};

export type CreateProjectResponse = {
	entityId: string;
	label: string;
	status: ProjectStatus;
};

const PROJECT_STATUS_KEYS = ['active', 'someday', 'completed'] as const;

function parseProjectStatus(value: unknown): ProjectStatus | undefined {
	return typeof value === 'string' &&
		(PROJECT_STATUS_KEYS as readonly string[]).includes(value)
		? (value as ProjectStatus)
		: undefined;
}

export const GET: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	const projects = await listProjectsForUser(user.id);
	return json({ projects } satisfies TimelineProjectsResponse);
};

export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized');

	let body: CreateProjectRequest;
	try {
		body = (await event.request.json()) as CreateProjectRequest;
	} catch {
		error(400, 'Invalid JSON body');
	}

	const label = body.label?.trim();
	if (!label) error(400, 'label is required');

	const status = parseProjectStatus(body.status);

	try {
		const result = await createUserDeclaredProject({
			userId: user.id,
			label,
			...(status ? { status } : {})
		});
		return json(result satisfies CreateProjectResponse);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		error(400, message);
	}
};
