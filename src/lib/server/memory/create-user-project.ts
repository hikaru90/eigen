import type { ProjectStatus } from '$lib/server/db/schema';
import { ensureProjectProfile } from '$lib/server/memory/project-eligibility';
import { promoteHubEntityType } from '$lib/server/memory/project-entity';
import { resolveProjectIdentity } from '$lib/server/memory/resolve-project-identity';

export type CreateUserProjectInput = {
	userId: string;
	label: string;
	status?: ProjectStatus;
};

export type CreateUserProjectResult = {
	entityId: string;
	label: string;
	status: ProjectStatus;
};

/** Create a GTD project from explicit user declaration (skips promotion judge). */
export async function createUserDeclaredProject(
	input: CreateUserProjectInput
): Promise<CreateUserProjectResult> {
	const label = input.label.trim();
	if (!label) {
		throw new Error('createUserDeclaredProject: label is required');
	}

	const status = input.status ?? 'active';

	const resolution = await resolveProjectIdentity({
		userId: input.userId,
		surfaceLabel: label,
		mode: 'seed'
	});

	await promoteHubEntityType(input.userId, resolution.entityId, resolution.canonicalLabel);
	await ensureProjectProfile(input.userId, resolution.entityId, status, 'manual');

	return {
		entityId: resolution.entityId,
		label: resolution.canonicalLabel,
		status
	};
}
