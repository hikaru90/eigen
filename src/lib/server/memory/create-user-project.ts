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

	console.log(`[createUserDeclaredProject] Creating project: ${label}, status: ${status}`);

	const resolution = await resolveProjectIdentity({
		userId: input.userId,
		surfaceLabel: label,
		mode: 'seed'
	});

	console.log(`[createUserDeclaredProject] Resolution result: entityId=${resolution.entityId}, label=${resolution.canonicalLabel}`);

	await promoteHubEntityType(input.userId, resolution.entityId, resolution.canonicalLabel);
	await ensureProjectProfile(input.userId, resolution.entityId, status, 'manual');

	console.log(`[createUserDeclaredProject] Project created successfully: ${resolution.entityId}`);

	return {
		entityId: resolution.entityId,
		label: resolution.canonicalLabel,
		status
	};
}
